#![allow(clippy::items_after_test_module)]

use crate::sync::crypto;
use crate::sync::crypto::EncryptionKey;
use crate::sync::manifest::EncryptionConfig;

use chrono::Utc;

mod apply;
mod attachment;
mod cleanup;
mod crypto_ops;
mod identity;
mod manifest_io;
mod remote;
mod rotation;
mod run;
mod validate;

pub(crate) use apply::{
    apply_batch, apply_snapshot, build_snapshot, current_payload, decode_snapshot, encode_snapshot,
    resolve_conflict_with_payload,
};
pub(crate) use crypto_ops::{decrypt_operations, encrypt_operations, encryption_context};
pub(crate) use validate::*;

pub(crate) use attachment::*;
pub(crate) use cleanup::*;
pub(crate) use identity::*;
pub(crate) use manifest_io::*;
pub(crate) use remote::*;
pub(crate) use rotation::*;
pub(crate) use run::*;

// ---- 共享常量与类型（子模块经 `use super::*` 访问） ----

const PROTOCOL: i64 = 2;
/// 仍可读取的最旧远端协议版本。
///
/// v1→v2 是纯增量变更（新增 attachment/taskLink 实体），Manifest / ChangeBatch /
/// Snapshot 的字段结构没有破坏性改动，因此 v2 客户端可以直接读 v1 集合。
/// 读到 v1 集合后会在下一次写 manifest 时就地升级为 v2（见 manifest_io.rs
/// `normalize_manifest_protocol`），避免老集合被永久判为 "incompatible" 而锁死同步。
const MIN_SUPPORTED_PROTOCOL: i64 = 1;
const SCHEMA_VERSION: i64 = 2;
const MIN_SUPPORTED_SCHEMA_VERSION: i64 = 1;

fn supported_protocol(protocol: i64) -> bool {
    (MIN_SUPPORTED_PROTOCOL..=PROTOCOL).contains(&protocol)
}

const MAX_BATCH_OPERATIONS: usize = 500;
const MAX_BATCH_JSON_BYTES: usize = 1024 * 1024;
const MAX_SNAPSHOT_OPERATIONS: usize = 50_000;
const MAX_SNAPSHOT_JSON_BYTES: u64 = 32 * 1024 * 1024;
const SNAPSHOT_INTERVAL: i64 = 100;
const SNAPSHOT_MIN_OBJECTS: usize = 100;

#[derive(Clone)]
pub(crate) struct EncryptionContext {
    config: EncryptionConfig,
    key: EncryptionKey,
}

const MAX_JSON_DEPTH: usize = 16;
const MAX_STRING_LENGTH: usize = 16 * 1024;
const MAX_ID_LENGTH: usize = 128;

#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod tests;
