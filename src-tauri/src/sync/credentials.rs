#[cfg(not(any(target_os = "android", target_os = "ios")))]
use keyring::{Entry, Error as CredentialError};
#[cfg(any(target_os = "android", target_os = "ios"))]
use keyring_core::{Entry, Error as CredentialError};

use crate::db::sync_repository;
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::crypto::{self, StoredKeys};

const SERVICE: &str = "com.zhaxideler.torder.webdav";
const ENCRYPTION_SERVICE: &str = "com.zhaxideler.torder.sync-encryption";
const CREDENTIAL_ID_KEY: &str = "credentialId";
const ENCRYPTION_CREDENTIAL_ID_KEY: &str = "encryptionCredentialId";

pub fn store(connection: &rusqlite::Connection, password: &str) -> RepositoryResult<()> {
    if password.is_empty() {
        return Err(RepositoryError::Validation(
            "WebDAV password cannot be empty",
        ));
    }
    ensure_store()?;
    let id = credential_id(connection, CREDENTIAL_ID_KEY)?;
    entry(SERVICE, &id)?
        .set_password(password)
        .map_err(keyring_error)
}

pub fn load(connection: &rusqlite::Connection) -> RepositoryResult<Option<String>> {
    ensure_store()?;
    let Some(id) = sync_repository::get_state(connection, CREDENTIAL_ID_KEY)? else {
        return Ok(None);
    };
    match entry(SERVICE, &id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(CredentialError::NoEntry) => Ok(None),
        Err(error) => Err(keyring_error(error)),
    }
}

pub fn remove(connection: &rusqlite::Connection) -> RepositoryResult<()> {
    ensure_store()?;
    let Some(id) = sync_repository::get_state(connection, CREDENTIAL_ID_KEY)? else {
        return Ok(());
    };
    match entry(SERVICE, &id)?.delete_credential() {
        Ok(()) | Err(CredentialError::NoEntry) => {}
        Err(error) => return Err(keyring_error(error)),
    }
    sync_repository::clear_state(connection, CREDENTIAL_ID_KEY)
}

pub fn is_available(connection: &rusqlite::Connection) -> RepositoryResult<bool> {
    Ok(load(connection)?.is_some())
}

pub fn store_encryption_keys(
    connection: &rusqlite::Connection,
    keys: &StoredKeys,
) -> RepositoryResult<()> {
    ensure_store()?;
    let id = credential_id(connection, ENCRYPTION_CREDENTIAL_ID_KEY)?;
    let encoded = serde_json::to_string(keys)?;
    entry(ENCRYPTION_SERVICE, &id)?
        .set_password(&encoded)
        .map_err(keyring_error)
}

pub fn load_encryption_keys(connection: &rusqlite::Connection) -> RepositoryResult<StoredKeys> {
    ensure_store()?;
    let Some(id) = sync_repository::get_state(connection, ENCRYPTION_CREDENTIAL_ID_KEY)? else {
        return Ok(StoredKeys::default());
    };
    match entry(ENCRYPTION_SERVICE, &id)?.get_password() {
        Ok(encoded) => serde_json::from_str(&encoded)
            .map_err(|_| RepositoryError::Validation("invalid stored sync encryption keys")),
        Err(CredentialError::NoEntry) => Ok(StoredKeys::default()),
        Err(error) => Err(keyring_error(error)),
    }
}

pub fn has_encryption_key(
    connection: &rusqlite::Connection,
    key_id: &str,
) -> RepositoryResult<bool> {
    Ok(crypto::stored_key(&load_encryption_keys(connection)?, key_id)?.is_some())
}

pub fn remove_encryption_keys(connection: &rusqlite::Connection) -> RepositoryResult<()> {
    ensure_store()?;
    let Some(id) = sync_repository::get_state(connection, ENCRYPTION_CREDENTIAL_ID_KEY)? else {
        return Ok(());
    };
    match entry(ENCRYPTION_SERVICE, &id)?.delete_credential() {
        Ok(()) | Err(CredentialError::NoEntry) => {}
        Err(error) => return Err(keyring_error(error)),
    }
    sync_repository::clear_state(connection, ENCRYPTION_CREDENTIAL_ID_KEY)
}

fn credential_id(connection: &rusqlite::Connection, state_key: &str) -> RepositoryResult<String> {
    if let Some(id) = sync_repository::get_state(connection, state_key)? {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    sync_repository::set_state(connection, state_key, &id)?;
    Ok(id)
}

fn entry(service: &str, id: &str) -> RepositoryResult<Entry> {
    ensure_store()?;
    Entry::new(service, id).map_err(keyring_error)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn keyring_error(error: keyring::Error) -> RepositoryError {
    // Never propagate platform-specific messages because they can include the credential name.
    let _ = error;
    RepositoryError::Tauri("system credential storage is unavailable".to_owned())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn keyring_error(error: keyring_core::Error) -> RepositoryError {
    let _ = error;
    RepositoryError::Tauri("system credential storage is unavailable".to_owned())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn ensure_store() -> RepositoryResult<()> {
    Ok(())
}

#[cfg(target_os = "android")]
fn ensure_store() -> RepositoryResult<()> {
    use std::sync::OnceLock;
    static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
    INITIALIZED
        .get_or_init(|| {
            android_native_keyring_store::Store::new()
                .map(|store| keyring_core::set_default_store(store))
                .map_err(|error| format!("{error:?}"))
        })
        .clone()
        .map_err(RepositoryError::Tauri)
}

#[cfg(target_os = "ios")]
fn ensure_store() -> RepositoryResult<()> {
    use std::sync::OnceLock;
    static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
    INITIALIZED
        .get_or_init(|| {
            apple_native_keyring_store::protected::Store::new()
                .map(|store| keyring_core::set_default_store(store))
                .map_err(|error| format!("{error:?}"))
        })
        .clone()
        .map_err(RepositoryError::Tauri)
}
