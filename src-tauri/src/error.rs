use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub enum RepositoryError {
    Database(rusqlite::Error),
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidBackup(String),
    Validation(&'static str),
    NotFound(&'static str),
}

impl Display for RepositoryError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "database error: {error}"),
            Self::Io(error) => write!(formatter, "file system error: {error}"),
            Self::Json(error) => write!(formatter, "json error: {error}"),
            Self::InvalidBackup(message) => write!(formatter, "invalid backup: {message}"),
            Self::Validation(message) => write!(formatter, "validation error: {message}"),
            Self::NotFound(entity) => write!(formatter, "{entity} not found"),
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

pub type RepositoryResult<T> = Result<T, RepositoryError>;
