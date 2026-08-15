use rusqlite::{params, Row};
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{CalendarEvent, CreateCalendarEventInput, UpdateCalendarEventInput};

use super::Database;

pub struct CalendarEventRepository<'database> {
    database: &'database Database,
}

impl<'database> CalendarEventRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list(&self) -> RepositoryResult<Vec<CalendarEvent>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&format!(
            "{} WHERE deleted_at IS NULL ORDER BY start_date ASC, created_at ASC",
            select_events()
        ))?;
        let events = statement
            .query_map([], map_event)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(events)
    }

    pub fn get(&self, id: &str) -> RepositoryResult<CalendarEvent> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            &format!("{} WHERE id = ?1 AND deleted_at IS NULL", select_events()),
            params![id],
            map_event,
        );
        match result {
            Ok(event) => Ok(event),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(RepositoryError::NotFound("calendar event"))
            }
            Err(error) => Err(error.into()),
        }
    }

    pub fn create(&self, input: CreateCalendarEventInput) -> RepositoryResult<CalendarEvent> {
        validate_input(
            &input.title,
            &input.event_type,
            &input.start_date,
            &input.end_date,
        )?;
        let id = Uuid::new_v4().to_string();
        let connection = self.database.connect()?;
        connection.execute(
            r#"
            INSERT INTO calendar_events (id, title, event_type, start_date, end_date, note)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                id,
                input.title.trim(),
                input.event_type,
                input.start_date,
                input.end_date,
                normalize_note(input.note),
            ],
        )?;
        self.get(&id)
    }

    pub fn update(&self, input: UpdateCalendarEventInput) -> RepositoryResult<CalendarEvent> {
        validate_input(
            &input.title,
            &input.event_type,
            &input.start_date,
            &input.end_date,
        )?;
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE calendar_events
            SET title = ?2,
                event_type = ?3,
                start_date = ?4,
                end_date = ?5,
                note = ?6,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![
                input.id,
                input.title.trim(),
                input.event_type,
                input.start_date,
                input.end_date,
                normalize_note(input.note),
            ],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("calendar event"));
        }
        self.get(&input.id)
    }

    pub fn soft_delete(&self, id: &str) -> RepositoryResult<()> {
        let connection = self.database.connect()?;
        let deleted = connection.execute(
            r#"
            UPDATE calendar_events
            SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id],
        )?;
        if deleted == 0 {
            return Err(RepositoryError::NotFound("calendar event"));
        }
        Ok(())
    }
}

fn validate_input(
    title: &str,
    event_type: &str,
    start_date: &str,
    end_date: &str,
) -> RepositoryResult<()> {
    if title.trim().is_empty() {
        return Err(RepositoryError::Validation(
            "calendar event title cannot be empty",
        ));
    }
    if !matches!(event_type, "leave" | "trip") {
        return Err(RepositoryError::Validation(
            "calendar event type must be leave or trip",
        ));
    }
    if !is_iso_date(start_date) || !is_iso_date(end_date) {
        return Err(RepositoryError::Validation(
            "calendar event dates must be YYYY-MM-DD",
        ));
    }
    if end_date < start_date {
        return Err(RepositoryError::Validation(
            "calendar event end date must not precede start date",
        ));
    }
    Ok(())
}

fn is_iso_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn normalize_note(note: Option<String>) -> Option<String> {
    note.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

fn select_events() -> &'static str {
    r#"
    SELECT id, title, event_type, start_date, end_date, note,
           created_at, updated_at, deleted_at
    FROM calendar_events
    "#
}

fn map_event(row: &Row<'_>) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        event_type: row.get(2)?,
        start_date: row.get(3)?,
        end_date: row.get(4)?,
        note: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}