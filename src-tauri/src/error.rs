use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub enum RepositoryError {
    Database(rusqlite::Error),
    Io(std::io::Error),
    Json(serde_json::Error),
    Archive(String),
    Tauri(String),
    Validation(&'static str),
    NotFound(&'static str),
    /// 远端序号已被其他设备占位（并发同步争用）。
    ///
    /// 这**不是**失败，而是一个明确的「重试即可」信号：远端 manifest 已经被别的
    /// 设备推进，本机手上的 `latestSequence` 已过期。调用方应重新读取 manifest
    /// 后再开一轮，而不是把它当作终态错误报给用户（issue 反馈：两台设备同时同步
    /// 时弹出 “remote sequence was claimed by another device; retry sync”）。
    RemoteSequenceTaken,
    /// 远端 manifest 在本次读写之间被其他设备改写（ETag/序号前置条件失败）。
    ///
    /// 与 `RemoteSequenceTaken` 同类：并发同步的正常结果，重读 manifest 后
    /// 重开一轮即可，不应向用户报错。
    RemoteManifestChanged,
}

impl RepositoryError {
    /// 并发争用类错误：调用方可以安全地重读远端状态后重试。
    pub fn is_retryable_conflict(&self) -> bool {
        matches!(
            self,
            Self::RemoteSequenceTaken | Self::RemoteManifestChanged
        )
    }
}

impl Display for RepositoryError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "database error: {error}"),
            Self::Io(error) => write!(formatter, "file system error: {error}"),
            Self::Json(error) => write!(formatter, "json error: {error}"),
            Self::Archive(message) => write!(formatter, "archive error: {message}"),
            Self::Tauri(message) => write!(formatter, "app error: {message}"),
            Self::Validation(message) => write!(formatter, "validation error: {message}"),
            Self::NotFound(entity) => write!(formatter, "{entity} not found"),
            Self::RemoteSequenceTaken => write!(
                formatter,
                "app error: remote sequence was claimed by another device; retrying"
            ),
            Self::RemoteManifestChanged => {
                write!(formatter, "app error: remote manifest changed; retrying")
            }
        }
    }
}

impl std::error::Error for RepositoryError {}

impl From<rusqlite::Error> for RepositoryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl From<std::io::Error> for RepositoryError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for RepositoryError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<zip::result::ZipError> for RepositoryError {
    fn from(error: zip::result::ZipError) -> Self {
        Self::Archive(error.to_string())
    }
}

impl From<chrono::ParseError> for RepositoryError {
    fn from(_error: chrono::ParseError) -> Self {
        Self::Validation("invalid date")
    }
}

impl From<tauri::Error> for RepositoryError {
    fn from(error: tauri::Error) -> Self {
        Self::Tauri(error.to_string())
    }
}

pub type RepositoryResult<T> = Result<T, RepositoryError>;
