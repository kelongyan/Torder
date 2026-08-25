use std::collections::BTreeMap;

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::manifest::EncryptionConfig;

const ALGORITHM: &str = "xchacha20poly1305";
const KDF: &str = "argon2id-v1";
const KEY_BYTES: usize = 32;
const SALT_BYTES: usize = 16;
const NONCE_BYTES: usize = 24;
const BLOB_MAGIC: &[u8] = b"TORDERBLOB1";

#[derive(Clone)]
pub struct EncryptionKey([u8; KEY_BYTES]);

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKeys {
    pub current_key_id: Option<String>,
    #[serde(default)]
    pub keys: BTreeMap<String, String>,
}

pub fn create_config(password: &str) -> RepositoryResult<(EncryptionConfig, EncryptionKey)> {
    if password.chars().count() < 8 {
        return Err(RepositoryError::Validation(
            "sync encryption password must contain at least 8 characters",
        ));
    }
    let mut salt = [0_u8; SALT_BYTES];
    OsRng.fill_bytes(&mut salt);
    let config = EncryptionConfig {
        algorithm: ALGORITHM.to_owned(),
        kdf: KDF.to_owned(),
        salt: STANDARD_NO_PAD.encode(salt),
        key_id: uuid::Uuid::new_v4().to_string(),
    };
    let key = derive_key(&config, password)?;
    Ok((config, key))
}

pub fn derive_key(config: &EncryptionConfig, password: &str) -> RepositoryResult<EncryptionKey> {
    validate_config(config)?;
    let salt = STANDARD_NO_PAD
        .decode(&config.salt)
        .map_err(|_| RepositoryError::Validation("invalid sync encryption salt"))?;
    if salt.len() != SALT_BYTES {
        return Err(RepositoryError::Validation("invalid sync encryption salt"));
    }
    let params = Params::new(19_456, 2, 1, Some(KEY_BYTES))
        .map_err(|_| RepositoryError::Validation("invalid sync encryption parameters"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0_u8; KEY_BYTES];
    argon2
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|_| RepositoryError::Validation("failed to derive sync encryption key"))?;
    Ok(EncryptionKey(key))
}

pub fn validate_config(config: &EncryptionConfig) -> RepositoryResult<()> {
    if config.algorithm != ALGORITHM
        || config.kdf != KDF
        || uuid::Uuid::parse_str(&config.key_id).is_err()
    {
        return Err(RepositoryError::Validation(
            "unsupported sync encryption configuration",
        ));
    }
    let salt = STANDARD_NO_PAD
        .decode(&config.salt)
        .map_err(|_| RepositoryError::Validation("invalid sync encryption salt"))?;
    if salt.len() != SALT_BYTES {
        return Err(RepositoryError::Validation("invalid sync encryption salt"));
    }
    Ok(())
}

pub fn add_stored_key(
    stored: &mut StoredKeys,
    key_id: &str,
    key: &EncryptionKey,
    make_current: bool,
) {
    stored
        .keys
        .insert(key_id.to_owned(), STANDARD_NO_PAD.encode(key.0));
    if make_current {
        stored.current_key_id = Some(key_id.to_owned());
    }
}

pub fn stored_key(stored: &StoredKeys, key_id: &str) -> RepositoryResult<Option<EncryptionKey>> {
    let Some(encoded) = stored.keys.get(key_id) else {
        return Ok(None);
    };
    let decoded = STANDARD_NO_PAD
        .decode(encoded)
        .map_err(|_| RepositoryError::Validation("invalid stored sync encryption key"))?;
    let bytes: [u8; KEY_BYTES] = decoded
        .try_into()
        .map_err(|_| RepositoryError::Validation("invalid stored sync encryption key"))?;
    Ok(Some(EncryptionKey(bytes)))
}

pub fn encrypt_value(
    value: &Value,
    key_id: &str,
    key: &EncryptionKey,
    associated_data: &[u8],
) -> RepositoryResult<Value> {
    let cipher = XChaCha20Poly1305::new_from_slice(&key.0)
        .map_err(|_| RepositoryError::Validation("invalid sync encryption key"))?;
    let mut nonce = [0_u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let plaintext = serde_json::to_vec(value)?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: associated_data,
            },
        )
        .map_err(|_| RepositoryError::Validation("failed to encrypt sync payload"))?;
    Ok(json!({
        "$encrypted": {
            "version": 1,
            "keyId": key_id,
            "nonce": STANDARD_NO_PAD.encode(nonce),
            "ciphertext": STANDARD_NO_PAD.encode(ciphertext),
        }
    }))
}

pub fn decrypt_value(
    value: &Value,
    expected_key_id: &str,
    key: &EncryptionKey,
    associated_data: &[u8],
) -> RepositoryResult<Value> {
    let envelope =
        value
            .get("$encrypted")
            .and_then(Value::as_object)
            .ok_or(RepositoryError::Validation(
                "invalid encrypted sync payload",
            ))?;
    if envelope
        .keys()
        .any(|key| !matches!(key.as_str(), "version" | "keyId" | "nonce" | "ciphertext"))
    {
        return Err(RepositoryError::Validation(
            "invalid encrypted sync payload",
        ));
    }
    if envelope.get("version").and_then(Value::as_i64) != Some(1)
        || envelope.get("keyId").and_then(Value::as_str) != Some(expected_key_id)
    {
        return Err(RepositoryError::Validation(
            "sync payload uses an unavailable encryption key",
        ));
    }
    let nonce = decode_field(envelope, "nonce")?;
    let ciphertext = decode_field(envelope, "ciphertext")?;
    if nonce.len() != NONCE_BYTES {
        return Err(RepositoryError::Validation(
            "invalid encrypted sync payload",
        ));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(&key.0)
        .map_err(|_| RepositoryError::Validation("invalid sync encryption key"))?;
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: associated_data,
            },
        )
        .map_err(|_| {
            RepositoryError::Validation("sync encryption password is incorrect or data is damaged")
        })?;
    serde_json::from_slice(&plaintext)
        .map_err(|_| RepositoryError::Validation("invalid decrypted sync payload"))
}

pub fn encrypt_bytes(
    plaintext: &[u8],
    key: &EncryptionKey,
    associated_data: &[u8],
) -> RepositoryResult<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new_from_slice(&key.0)
        .map_err(|_| RepositoryError::Validation("invalid sync encryption key"))?;
    let mut nonce = [0_u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: associated_data,
            },
        )
        .map_err(|_| RepositoryError::Validation("failed to encrypt sync payload"))?;
    let mut output = Vec::with_capacity(BLOB_MAGIC.len() + NONCE_BYTES + ciphertext.len());
    output.extend_from_slice(BLOB_MAGIC);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

pub fn decrypt_bytes(
    payload: &[u8],
    key: &EncryptionKey,
    associated_data: &[u8],
) -> RepositoryResult<Vec<u8>> {
    if payload.len() <= BLOB_MAGIC.len() + NONCE_BYTES || !payload.starts_with(BLOB_MAGIC) {
        return Err(RepositoryError::Validation(
            "invalid encrypted sync payload",
        ));
    }
    let nonce_start = BLOB_MAGIC.len();
    let ciphertext_start = nonce_start + NONCE_BYTES;
    let cipher = XChaCha20Poly1305::new_from_slice(&key.0)
        .map_err(|_| RepositoryError::Validation("invalid sync encryption key"))?;
    cipher
        .decrypt(
            XNonce::from_slice(&payload[nonce_start..ciphertext_start]),
            Payload {
                msg: &payload[ciphertext_start..],
                aad: associated_data,
            },
        )
        .map_err(|_| {
            RepositoryError::Validation("sync encryption password is incorrect or data is damaged")
        })
}

fn decode_field(
    envelope: &serde_json::Map<String, Value>,
    field: &str,
) -> RepositoryResult<Vec<u8>> {
    let encoded =
        envelope
            .get(field)
            .and_then(Value::as_str)
            .ok_or(RepositoryError::Validation(
                "invalid encrypted sync payload",
            ))?;
    STANDARD_NO_PAD
        .decode(encoded)
        .map_err(|_| RepositoryError::Validation("invalid encrypted sync payload"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_payload_round_trips_and_authenticates_metadata() {
        let (config, key) = create_config("correct horse battery staple").unwrap();
        let value = json!({"title": "不会出现在远端明文", "priority": 2});
        let encrypted = encrypt_value(&value, &config.key_id, &key, b"task|id|1").unwrap();
        assert!(!serde_json::to_string(&encrypted)
            .unwrap()
            .contains("不会出现在远端明文"));
        assert_eq!(
            decrypt_value(&encrypted, &config.key_id, &key, b"task|id|1").unwrap(),
            value
        );
        assert!(decrypt_value(&encrypted, &config.key_id, &key, b"task|other|1").is_err());
    }

    #[test]
    fn encrypted_payload_rejects_unknown_envelope_fields() {
        let (config, key) = create_config("correct horse battery staple").unwrap();
        let mut encrypted =
            encrypt_value(&json!({"ok": true}), &config.key_id, &key, b"aad").unwrap();
        encrypted["$encrypted"]["unexpected"] = json!(true);
        assert!(matches!(
            decrypt_value(&encrypted, &config.key_id, &key, b"aad"),
            Err(RepositoryError::Validation(
                "invalid encrypted sync payload"
            ))
        ));
    }

    #[test]
    fn encrypted_blob_round_trips_without_plaintext() {
        let (_config, key) = create_config("correct horse battery staple").unwrap();
        let plaintext = b"managed attachment secret";
        let encrypted = encrypt_bytes(plaintext, &key, b"attachmentBlob|id|hash|23|key").unwrap();
        assert!(!encrypted
            .windows("managed attachment secret".len())
            .any(|window| window == b"managed attachment secret"));
        assert_eq!(
            decrypt_bytes(&encrypted, &key, b"attachmentBlob|id|hash|23|key").unwrap(),
            plaintext
        );
        assert!(decrypt_bytes(&encrypted, &key, b"attachmentBlob|id|hash|23|other").is_err());
    }

    #[test]
    fn stored_key_round_trips_without_password() {
        let (config, key) = create_config("another strong password").unwrap();
        let mut stored = StoredKeys::default();
        add_stored_key(&mut stored, &config.key_id, &key, true);
        let restored = stored_key(&stored, &config.key_id).unwrap().unwrap();
        let value = json!({"ok": true});
        let encrypted = encrypt_value(&value, &config.key_id, &restored, b"aad").unwrap();
        assert_eq!(
            decrypt_value(&encrypted, &config.key_id, &restored, b"aad").unwrap(),
            value
        );
    }

    #[test]
    fn rejects_invalid_manifest_salt_during_config_validation() {
        let (mut config, _) = create_config("another strong password").unwrap();
        config.salt = STANDARD_NO_PAD.encode([0_u8; SALT_BYTES - 1]);
        assert!(matches!(
            validate_config(&config),
            Err(RepositoryError::Validation("invalid sync encryption salt"))
        ));
    }
}
