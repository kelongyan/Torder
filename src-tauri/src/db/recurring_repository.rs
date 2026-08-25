use chrono::{DateTime, Datelike, Duration, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, Row, Transaction};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{
    CreateRecurringRuleInput, RecurringGenerationResult, RecurringRule, UpdateRecurringRuleInput,
};
use crate::recurrence::{next_occurrence, parse_utc, validate_schedule, ScheduleValidation};

use super::{sync_repository, Database};

pub struct RecurringRuleRepository<'database> {
    database: &'database Database,
}

impl<'database> RecurringRuleRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list(&self) -> RepositoryResult<Vec<RecurringRule>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&format!(
            "{} WHERE deleted_at IS NULL ORDER BY enabled DESC, next_due_at, created_at DESC",
            select_rules()
        ))?;
        let rules = statement
            .query_map([], map_rule)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rules)
    }

    pub fn export_all(&self) -> RepositoryResult<Vec<RecurringRule>> {
        self.list()
    }

    pub fn get(&self, id: &str) -> RepositoryResult<RecurringRule> {
        let connection = self.database.connect()?;
        connection
            .query_row(
                &format!("{} WHERE id = ?1 AND deleted_at IS NULL", select_rules()),
                params![id],
                map_rule,
            )
            .optional()?
            .ok_or(RepositoryError::NotFound("recurring rule"))
    }

    pub fn create(&self, input: CreateRecurringRuleInput) -> RepositoryResult<RecurringRule> {
        validate_input(RecurringRuleValidation {
            title: &input.title,
            priority: input.priority,
            schedule: ScheduleValidation {
                frequency: &input.frequency,
                interval_count: input.interval_count,
                weekdays: &input.weekdays,
                month_day: input.month_day,
                first_due_at: &input.first_due_at,
                timezone: &input.timezone,
                generate_ahead_minutes: input.generate_ahead_minutes,
                remind_before: input.remind_before,
                end_at: input.end_at.as_deref(),
            },
        })?;
        let id = Uuid::new_v4().to_string();
        let title = input.title.trim();
        let note = normalize_note(input.note.clone());
        let weekdays = serde_json::to_string(&normalize_weekdays(&input.weekdays))?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            r#"
            INSERT INTO recurring_rules (
                id, title, note, priority, list_id, frequency, interval_count,
                weekdays, month_day, first_due_at, next_due_at, timezone,
                generate_ahead_minutes, remind_before, end_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?12, ?13, ?14
            )
            "#,
            params![
                id,
                title,
                note,
                input.priority,
                input.list_id,
                input.frequency,
                input.interval_count,
                weekdays,
                input.month_day,
                input.first_due_at,
                input.timezone,
                input.generate_ahead_minutes,
                input.remind_before,
                input.end_at,
            ],
        )?;
        if let Some(source_task_id) = input.source_task_id {
            let linked = transaction.execute(
                r#"
                UPDATE tasks
                SET recurring_rule_id = ?2,
                    occurrence_at = ?3,
                    repeat_rule = NULL,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?1 AND deleted_at IS NULL
                "#,
                params![source_task_id, id, input.first_due_at],
            )?;
            if linked == 0 {
                transaction.execute("DELETE FROM recurring_rules WHERE id = ?1", params![id])?;
                return Err(RepositoryError::NotFound("source task"));
            }
            sync_repository::record_change(
                &transaction,
                "task",
                &source_task_id,
                "upsert",
                current_task_payload(&transaction, &source_task_id)?,
            )?;
        }
        sync_repository::record_change(
            &transaction,
            "recurringRule",
            &id,
            "upsert",
            json!({
                "id": id,
                "title": title,
                "note": note,
                "priority": input.priority,
                "listId": input.list_id,
                "frequency": input.frequency,
                "intervalCount": input.interval_count,
                "weekdays": normalize_weekdays(&input.weekdays),
                "monthDay": input.month_day,
                "firstDueAt": input.first_due_at,
                "nextDueAt": input.first_due_at,
                "timezone": input.timezone,
                "generateAheadMinutes": input.generate_ahead_minutes,
                "remindBefore": input.remind_before,
                "endAt": input.end_at,
                "enabled": true,
                "deletedAt": null,
            }),
        )?;
        transaction.commit()?;
        self.get(&id)
    }

    pub fn update(&self, input: UpdateRecurringRuleInput) -> RepositoryResult<RecurringRule> {
        validate_input(RecurringRuleValidation {
            title: &input.title,
            priority: input.priority,
            schedule: ScheduleValidation {
                frequency: &input.frequency,
                interval_count: input.interval_count,
                weekdays: &input.weekdays,
                month_day: input.month_day,
                first_due_at: &input.first_due_at,
                timezone: &input.timezone,
                generate_ahead_minutes: input.generate_ahead_minutes,
                remind_before: input.remind_before,
                end_at: input.end_at.as_deref(),
            },
        })?;
        let existing = self.get(&input.id)?;
        let title = input.title.trim();
        let note = normalize_note(input.note.clone());
        let normalized_weekdays = normalize_weekdays(&input.weekdays);
        let weekdays = serde_json::to_string(&normalized_weekdays)?;

        // 仅在排期本身发生变化时才重排 next_due_at。改标题/备注/优先级/清单/提醒
        // 不应该把进度倒回首次到期时间，否则用户之前的“跳过”会被静默作废。
        let schedule_changed = existing.frequency != input.frequency
            || existing.interval_count != input.interval_count
            || existing.weekdays != normalized_weekdays
            || existing.month_day != input.month_day
            || existing.first_due_at != input.first_due_at
            || existing.timezone != input.timezone;

        let next_due_at = if schedule_changed {
            Some(input.first_due_at.clone())
        } else {
            existing.next_due_at.clone()
        };
        // 结束时间可能被改早，导致保留下来的 next_due_at 已越界。
        let next_due_at = match next_due_at {
            Some(value) => {
                let bounded = match input.end_at.as_deref() {
                    Some(end) => parse_utc(&value)? <= parse_utc(end)?,
                    None => true,
                };
                bounded.then_some(value)
            }
            None => None,
        };

        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE recurring_rules
            SET title = ?2,
                note = ?3,
                priority = ?4,
                list_id = ?5,
                frequency = ?6,
                interval_count = ?7,
                weekdays = ?8,
                month_day = ?9,
                first_due_at = ?10,
                next_due_at = ?15,
                timezone = ?11,
                generate_ahead_minutes = ?12,
                remind_before = ?13,
                end_at = ?14,
                enabled = CASE WHEN ?15 IS NULL THEN 0 ELSE enabled END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![
                input.id,
                title,
                note,
                input.priority,
                input.list_id,
                input.frequency,
                input.interval_count,
                weekdays,
                input.month_day,
                input.first_due_at,
                input.timezone,
                input.generate_ahead_minutes,
                input.remind_before,
                input.end_at,
                next_due_at,
            ],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("recurring rule"));
        }
        let enabled = transaction.query_row(
            "SELECT enabled FROM recurring_rules WHERE id = ?1",
            params![input.id],
            |row| row.get::<_, i64>(0),
        )? != 0;
        sync_repository::record_change(
            &transaction,
            "recurringRule",
            &input.id,
            "upsert",
            json!({
                "id": input.id,
                "title": title,
                "note": note,
                "priority": input.priority,
                "listId": input.list_id,
                "frequency": input.frequency,
                "intervalCount": input.interval_count,
                "weekdays": normalized_weekdays,
                "monthDay": input.month_day,
                "firstDueAt": input.first_due_at,
                "nextDueAt": next_due_at,
                "timezone": input.timezone,
                "generateAheadMinutes": input.generate_ahead_minutes,
                "remindBefore": input.remind_before,
                "endAt": input.end_at,
                "enabled": enabled,
            }),
        )?;
        transaction.commit()?;
        self.get(&input.id)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> RepositoryResult<RecurringRule> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE recurring_rules
            SET enabled = ?2,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id, enabled],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("recurring rule"));
        }
        sync_repository::record_change(
            &transaction,
            "recurringRule",
            id,
            "upsert",
            json!({ "id": id, "enabled": enabled }),
        )?;
        transaction.commit()?;
        self.get(id)
    }

    pub fn skip_next(&self, id: &str) -> RepositoryResult<RecurringRule> {
        let rule = self.get(id)?;
        let current = rule
            .next_due_at
            .as_deref()
            .ok_or(RepositoryError::Validation("recurring rule has ended"))?;
        let next = next_occurrence(&rule, current)?;
        let next = within_end(&rule, &next)?.then_some(next);
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            r#"
            UPDATE recurring_rules
            SET next_due_at = ?2,
                enabled = CASE WHEN ?2 IS NULL THEN 0 ELSE enabled END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id, next],
        )?;
        sync_repository::record_change(
            &transaction,
            "recurringRule",
            id,
            "upsert",
            next_due_change_payload(&transaction, id, next.as_deref())?,
        )?;
        transaction.commit()?;
        self.get(id)
    }

    pub fn soft_delete(&self, id: &str, delete_future_tasks: bool) -> RepositoryResult<()> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE recurring_rules
            SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                enabled = 0,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("recurring rule"));
        }
        if delete_future_tasks {
            let future_task_ids = {
                let mut statement = transaction.prepare(
                    r#"SELECT id FROM tasks
                       WHERE recurring_rule_id = ?1
                         AND status = 'todo'
                         AND deleted_at IS NULL
                         AND due_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"#,
                )?;
                let ids = statement
                    .query_map(params![id], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                ids
            };
            let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
            transaction.execute(
                r#"
                UPDATE tasks
                SET deleted_at = ?2,
                    updated_at = ?2
                WHERE recurring_rule_id = ?1
                  AND status = 'todo'
                  AND deleted_at IS NULL
                  AND due_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                "#,
                params![id, now],
            )?;
            for task_id in future_task_ids {
                sync_repository::record_change(
                    &transaction,
                    "task",
                    &task_id,
                    "delete",
                    json!({ "id": task_id, "deletedAt": now }),
                )?;
            }
        }
        sync_repository::record_change(
            &transaction,
            "recurringRule",
            id,
            "delete",
            json!({
                "id": id,
                "deletedAt": Utc::now().to_rfc3339(),
                "enabled": false,
            }),
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn generate_due(&self) -> RepositoryResult<RecurringGenerationResult> {
        self.generate_due_at(Utc::now())
    }

    pub fn generate_due_at(
        &self,
        now: DateTime<Utc>,
    ) -> RepositoryResult<RecurringGenerationResult> {
        let rules = self.list()?.into_iter().filter(|rule| rule.enabled);
        let mut generated_count = 0;
        for rule in rules {
            let Some(mut cursor) = rule.next_due_at.clone() else {
                continue;
            };
            let mut selected = None;
            let mut next_due = Some(cursor.clone());

            for _ in 0..10_000 {
                if !within_end(&rule, &cursor)? {
                    next_due = None;
                    break;
                }
                let due = parse_utc(&cursor)?;
                let creation_time = due - Duration::minutes(rule.generate_ahead_minutes);
                if creation_time > now {
                    next_due = Some(cursor);
                    break;
                }
                selected = Some(cursor.clone());
                cursor = next_occurrence(&rule, &cursor)?;
                next_due = Some(cursor.clone());
            }

            if let Some(next) = next_due.as_deref() {
                if !within_end(&rule, next)? {
                    next_due = None;
                }
            }

            if let Some(occurrence) = selected {
                let mut connection = self.database.connect()?;
                let transaction = connection.transaction()?;
                generated_count += insert_occurrence(&transaction, &rule, &occurrence, now)?;
                update_next_due(&transaction, &rule.id, next_due.as_deref())?;
                transaction.commit()?;
            } else if next_due.is_none() {
                let mut connection = self.database.connect()?;
                update_next_due_connection(&mut connection, &rule.id, None)?;
            }
        }
        Ok(RecurringGenerationResult { generated_count })
    }

    pub fn generate_next_now(&self, id: &str) -> RepositoryResult<RecurringGenerationResult> {
        let rule = self.get(id)?;
        let occurrence = rule
            .next_due_at
            .as_deref()
            .ok_or(RepositoryError::Validation("recurring rule has ended"))?;
        if !within_end(&rule, occurrence)? {
            return Err(RepositoryError::Validation("recurring rule has ended"));
        }
        let next = next_occurrence(&rule, occurrence)?;
        let next = within_end(&rule, &next)?.then_some(next);
        let now = Utc::now();
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let generated_count = insert_occurrence(&transaction, &rule, occurrence, now)?;
        update_next_due(&transaction, &rule.id, next.as_deref())?;
        transaction.commit()?;
        Ok(RecurringGenerationResult { generated_count })
    }
}

fn insert_occurrence(
    transaction: &Transaction<'_>,
    rule: &RecurringRule,
    occurrence: &str,
    now: DateTime<Utc>,
) -> RepositoryResult<usize> {
    let id = Uuid::new_v4().to_string();
    let scheduled_date = occurrence_scheduled_date(occurrence, &rule.timezone)?;
    let remind_at = rule.remind_before.and_then(|minutes| {
        let value = parse_utc(occurrence).ok()? - Duration::minutes(minutes);
        (value > now).then(|| value.to_rfc3339_opts(SecondsFormat::Secs, true))
    });
    let inserted = transaction.execute(
        r#"
        INSERT OR IGNORE INTO tasks (
            id, title, note, status, priority, list_id, scheduled_date, due_at, sort_order,
            remind_before, remind_at, repeat_rule, recurring_rule_id, occurrence_at
        ) VALUES (?1, ?2, ?3, 'todo', ?4, ?5, ?6, ?7, 0, ?8, ?9, NULL, ?10, ?7)
        "#,
        params![
            id,
            rule.title,
            rule.note,
            rule.priority,
            rule.list_id,
            scheduled_date,
            occurrence,
            rule.remind_before,
            remind_at,
            rule.id,
        ],
    )?;
    if inserted > 0 {
        sync_repository::record_change(
            transaction,
            "task",
            &id,
            "upsert",
            json!({
                "id": id,
                "title": rule.title,
                "note": rule.note,
                "status": "todo",
                "priority": rule.priority,
                "listId": rule.list_id,
                "scheduledDate": scheduled_date,
                "dueAt": occurrence,
                "remindBefore": rule.remind_before,
                "remindAt": remind_at,
                "subtasks": [],
                "tags": [],
                "recurringRuleId": rule.id,
                "occurrenceAt": occurrence,
                "deletedAt": null,
            }),
        )?;
    }
    Ok(inserted)
}

fn update_next_due(
    transaction: &Transaction<'_>,
    id: &str,
    next_due_at: Option<&str>,
) -> RepositoryResult<()> {
    transaction.execute(
        r#"
        UPDATE recurring_rules
        SET next_due_at = ?2,
            enabled = CASE WHEN ?2 IS NULL THEN 0 ELSE enabled END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND deleted_at IS NULL
        "#,
        params![id, next_due_at],
    )?;
    sync_repository::record_change(
        transaction,
        "recurringRule",
        id,
        "upsert",
        next_due_change_payload(transaction, id, next_due_at)?,
    )?;
    Ok(())
}

fn update_next_due_connection(
    connection: &mut rusqlite::Connection,
    id: &str,
    next_due_at: Option<&str>,
) -> RepositoryResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute(
        r#"
        UPDATE recurring_rules
        SET next_due_at = ?2,
            enabled = CASE WHEN ?2 IS NULL THEN 0 ELSE enabled END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND deleted_at IS NULL
        "#,
        params![id, next_due_at],
    )?;
    sync_repository::record_change(
        &transaction,
        "recurringRule",
        id,
        "upsert",
        next_due_change_payload(&transaction, id, next_due_at)?,
    )?;
    transaction.commit()?;
    Ok(())
}

fn next_due_change_payload(
    transaction: &Transaction<'_>,
    id: &str,
    next_due_at: Option<&str>,
) -> RepositoryResult<serde_json::Value> {
    let enabled = transaction.query_row(
        "SELECT enabled FROM recurring_rules WHERE id = ?1",
        params![id],
        |row| row.get::<_, i64>(0),
    )? != 0;
    Ok(json!({
        "id": id,
        "nextDueAt": next_due_at,
        "enabled": enabled,
    }))
}

fn current_task_payload(transaction: &Transaction<'_>, task_id: &str) -> RepositoryResult<Value> {
    let encoded = transaction.query_row(
        r#"SELECT json_object(
            'id', id, 'title', title, 'note', note, 'status', status,
            'priority', priority, 'listId', list_id, 'scheduledDate', scheduled_date, 'dueAt', due_at,
            'completedAt', completed_at, 'sortOrder', sort_order,
            'remindBefore', remind_before, 'remindAt', remind_at,
            'repeatRule', repeat_rule, 'subtasks', json(subtasks), 'tags', json(tags),
            'recurringRuleId', recurring_rule_id,
            'occurrenceAt', occurrence_at, 'createdAt', created_at,
            'updatedAt', updated_at, 'deletedAt', deleted_at
        ) FROM tasks WHERE id = ?1"#,
        params![task_id],
        |row| row.get::<_, String>(0),
    )?;
    Ok(serde_json::from_str(&encoded)?)
}

fn occurrence_scheduled_date(occurrence: &str, timezone: &str) -> RepositoryResult<String> {
    let timezone = timezone
        .parse::<chrono_tz::Tz>()
        .map_err(|_| RepositoryError::Validation("invalid recurring timezone"))?;
    let local = parse_utc(occurrence)?.with_timezone(&timezone);
    Ok(format!(
        "{:04}-{:02}-{:02}",
        local.year(),
        local.month(),
        local.day()
    ))
}

fn within_end(rule: &RecurringRule, occurrence: &str) -> RepositoryResult<bool> {
    match rule.end_at.as_deref() {
        Some(end) => Ok(parse_utc(occurrence)? <= parse_utc(end)?),
        None => Ok(true),
    }
}

struct RecurringRuleValidation<'a> {
    title: &'a str,
    priority: i64,
    schedule: ScheduleValidation<'a>,
}

fn validate_input(input: RecurringRuleValidation<'_>) -> RepositoryResult<()> {
    if input.title.trim().is_empty() {
        return Err(RepositoryError::Validation(
            "recurring task title cannot be empty",
        ));
    }
    if !(0..=2).contains(&input.priority) {
        return Err(RepositoryError::Validation(
            "priority must be between 0 and 2",
        ));
    }
    validate_schedule(input.schedule)
}

fn normalize_weekdays(weekdays: &[i64]) -> Vec<i64> {
    let mut weekdays = weekdays.to_vec();
    weekdays.sort_unstable();
    weekdays.dedup();
    weekdays
}

fn normalize_note(note: Option<String>) -> Option<String> {
    note.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

fn select_rules() -> &'static str {
    r#"
    SELECT id, title, note, priority, list_id, frequency, interval_count,
           weekdays, month_day, first_due_at, next_due_at, timezone,
           generate_ahead_minutes, remind_before, end_at, enabled,
           created_at, updated_at, deleted_at
    FROM recurring_rules
    "#
}

fn map_rule(row: &Row<'_>) -> rusqlite::Result<RecurringRule> {
    let weekdays_json: String = row.get(7)?;
    let weekdays = serde_json::from_str(&weekdays_json).unwrap_or_default();
    Ok(RecurringRule {
        id: row.get(0)?,
        title: row.get(1)?,
        note: row.get(2)?,
        priority: row.get(3)?,
        list_id: row.get(4)?,
        frequency: row.get(5)?,
        interval_count: row.get(6)?,
        weekdays,
        month_day: row.get(8)?,
        first_due_at: row.get(9)?,
        next_due_at: row.get(10)?,
        timezone: row.get(11)?,
        generate_ahead_minutes: row.get(12)?,
        remind_before: row.get(13)?,
        end_at: row.get(14)?,
        enabled: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        deleted_at: row.get(18)?,
    })
}
