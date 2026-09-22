use rusqlite::params;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{Setting, UpsertSettingInput};

use super::sync_repository;
use super::Database;

pub struct SettingsRepository<'database> {
    database: &'database Database,
}

impl<'database> SettingsRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list(&self) -> RepositoryResult<Vec<Setting>> {
        let connection = self.database.connect()?;
        let mut statement =
            connection.prepare("SELECT key, value, updated_at FROM settings ORDER BY key ASC")?;
        let settings = statement
            .query_map([], |row| {
                Ok(Setting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(settings)
    }

    pub fn get(&self, key: &str) -> RepositoryResult<Option<Setting>> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            "SELECT key, value, updated_at FROM settings WHERE key = ?1",
            params![key],
            |row| {
                Ok(Setting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            },
        );
        match result {
            Ok(setting) => Ok(Some(setting)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn upsert(&self, input: UpsertSettingInput) -> RepositoryResult<Setting> {
        let key = input.key.trim();
        if key.is_empty() {
            return Err(RepositoryError::Validation("setting key cannot be empty"));
        }
        let parsed: serde_json::Value = serde_json::from_str(&input.value)
            .map_err(|_| RepositoryError::Validation("setting value must be valid JSON"))?;

        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            r#"
            INSERT INTO settings (key, value) VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
            params![key, input.value],
        )?;
        // 同步变更记录必须与设置写入同事务提交：分开写会出现「设置已改、
        // 变更没记」的静默漏同步（用户看到本地变了，别的设备永远不更新）。
        record_settings_change(&transaction, key, &parsed)?;
        transaction.commit()?;
        self.get(key)?.ok_or(RepositoryError::NotFound("setting"))
    }
}

/// 记录一条设置变更（若该键在同步白名单内）。
///
/// 非白名单键静默跳过——`launchAtStartup`、`sync*`、`focusDndUntil` 之类
/// 本就不该跨设备，让这里无脑记录会把设备私有配置推上云。
pub(crate) fn record_settings_change(
    transaction: &rusqlite::Transaction<'_>,
    key: &str,
    value: &serde_json::Value,
) -> RepositoryResult<()> {
    let Some(projected) = crate::sync::settings_policy::project_for_sync(key, value) else {
        return Ok(());
    };
    sync_repository::record_change(
        transaction,
        "settings",
        key,
        "upsert",
        serde_json::json!({
            "id": key,
            "key": key,
            "value": projected,
            "updatedAt": chrono::Utc::now()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }),
    )
}
