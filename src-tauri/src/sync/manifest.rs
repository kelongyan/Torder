use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub protocol: i64,
    pub collection_id: String,
    pub format: String,
    pub schema_version: i64,
    pub latest_sequence: i64,
    #[serde(default)]
    pub snapshot_sequence: i64,
    pub updated_at: String,
    #[serde(default)]
    pub encryption: Option<EncryptionConfig>,
    #[serde(default)]
    pub devices: Vec<ManifestDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionConfig {
    pub algorithm: String,
    pub kdf: String,
    pub salt: String,
    pub key_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub protocol: i64,
    pub sequence: i64,
    pub created_at: String,
    pub operations: Vec<ChangeOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDevice {
    pub id: String,
    pub name: String,
    pub last_seen_at: String,
    #[serde(default)]
    pub last_sequence: i64,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ChangeBatch {
    pub protocol: i64,
    pub sequence: i64,
    pub device_id: String,
    pub created_at: String,
    pub operations: Vec<ChangeOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ChangeOperation {
    pub id: String,
    pub entity: String,
    pub object_id: String,
    pub operation: String,
    pub base_revision: i64,
    pub revision: i64,
    pub changed_at: String,
    pub payload: serde_json::Value,
}
