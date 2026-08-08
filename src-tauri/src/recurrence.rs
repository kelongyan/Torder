use chrono::{
    DateTime, Datelike, Days, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc,
};
use chrono_tz::Tz;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::RecurringRule;

pub fn validate_schedule(
    frequency: &str,
    interval_count: i64,
    weekdays: &[i64],
    month_day: Option<i64>,
    first_due_at: &str,
    timezone: &str,
    generate_ahead_minutes: i64,
    remind_before: Option<i64>,
    end_at: Option<&str>,
) -> RepositoryResult<()> {
    if !matches!(frequency, "daily" | "weekly" | "monthly" | "quarterly") {
        return Err(RepositoryError::Validation("invalid recurring frequency"));
    }
    if !(1..=365).contains(&interval_count) {
        return Err(RepositoryError::Validation(
            "recurring interval must be between 1 and 365",
        ));
    }
    if frequency == "weekly"
        && (weekdays.is_empty() || weekdays.iter().any(|day| !(0..=6).contains(day)))
    {
        return Err(RepositoryError::Validation(
            "weekly recurring rules require valid weekdays",
        ));
    }
    if matches!(frequency, "monthly" | "quarterly") && !matches!(month_day, Some(1..=31)) {
        return Err(RepositoryError::Validation(
            "monthly recurring rules require a month day",
        ));
    }
    if generate_ahead_minutes < 0 || remind_before.is_some_and(|minutes| minutes < 0) {
        return Err(RepositoryError::Validation(
            "recurring offsets cannot be negative",
        ));
    }

    let first_due = parse_utc(first_due_at)?;
    parse_timezone(timezone)?;
    if let Some(end_at) = end_at {
        if parse_utc(end_at)? < first_due {
            return Err(RepositoryError::Validation(
                "recurring end must not precede first due date",
            ));
        }
    }
    Ok(())
}

pub fn next_occurrence(rule: &RecurringRule, current: &str) -> RepositoryResult<String> {
    let timezone = parse_timezone(&rule.timezone)?;
    let current_utc = parse_utc(current)?;
    let first_utc = parse_utc(&rule.first_due_at)?;
    let current_local = current_utc.with_timezone(&timezone);
    let first_local = first_utc.with_timezone(&timezone);
    let interval = rule.interval_count.max(1) as u64;

    let next_local = match rule.frequency.as_str() {
        "daily" => resolve_local(
            timezone,
            current_local
                .date_naive()
                .checked_add_days(Days::new(interval))
                .and_then(|date| {
                    date.and_hms_opt(
                        first_local.hour(),
                        first_local.minute(),
                        first_local.second(),
                    )
                })
                .ok_or(RepositoryError::Validation("invalid recurring date"))?,
        )
        .ok_or(RepositoryError::Validation("invalid recurring local time"))?,
        "weekly" => {
            let anchor_monday = first_local.date_naive()
                - Days::new(first_local.weekday().num_days_from_monday() as u64);
            let mut date = current_local.date_naive();
            let mut found = None;
            for _ in 0..(interval * 7 + 7) {
                date = date
                    .checked_add_days(Days::new(1))
                    .ok_or(RepositoryError::Validation("invalid recurring date"))?;
                let candidate_monday =
                    date - Days::new(date.weekday().num_days_from_monday() as u64);
                let week_delta = candidate_monday
                    .signed_duration_since(anchor_monday)
                    .num_weeks();
                let selected = rule
                    .weekdays
                    .contains(&(date.weekday().num_days_from_sunday() as i64));
                if selected && week_delta >= 0 && week_delta % rule.interval_count == 0 {
                    found = Some(date);
                    break;
                }
            }
            let date = found.ok_or(RepositoryError::Validation(
                "could not calculate next weekly occurrence",
            ))?;
            resolve_local(
                timezone,
                date.and_hms_opt(
                    first_local.hour(),
                    first_local.minute(),
                    first_local.second(),
                )
                .ok_or(RepositoryError::Validation("invalid recurring date"))?,
            )
            .ok_or(RepositoryError::Validation("invalid recurring local time"))?
        }
        "monthly" | "quarterly" => {
            let multiplier = if rule.frequency == "quarterly" { 3 } else { 1 };
            let months = rule.interval_count * multiplier;
            let month_index =
                current_local.year() as i64 * 12 + current_local.month0() as i64 + months;
            let year = month_index.div_euclid(12) as i32;
            let month = month_index.rem_euclid(12) as u32 + 1;
            let requested_day = rule.month_day.unwrap_or(first_local.day() as i64) as u32;
            let day = requested_day.min(days_in_month(year, month));
            let date = NaiveDate::from_ymd_opt(year, month, day)
                .ok_or(RepositoryError::Validation("invalid recurring date"))?;
            resolve_local(
                timezone,
                date.and_hms_opt(
                    first_local.hour(),
                    first_local.minute(),
                    first_local.second(),
                )
                .ok_or(RepositoryError::Validation("invalid recurring date"))?,
            )
            .ok_or(RepositoryError::Validation("invalid recurring local time"))?
        }
        _ => return Err(RepositoryError::Validation("invalid recurring frequency")),
    };

    Ok(next_local
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

pub fn parse_utc(value: &str) -> RepositoryResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .map_err(|_| RepositoryError::Validation("invalid recurring date"))
}

fn parse_timezone(value: &str) -> RepositoryResult<Tz> {
    value
        .parse::<Tz>()
        .map_err(|_| RepositoryError::Validation("invalid recurring timezone"))
}

fn resolve_local(timezone: Tz, local: NaiveDateTime) -> Option<DateTime<Tz>> {
    match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, _) => Some(first),
        LocalResult::None => timezone
            .from_local_datetime(&(local + chrono::Duration::hours(1)))
            .earliest(),
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid month");
    first_next
        .pred_opt()
        .expect("month has a previous day")
        .day()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(frequency: &str, first_due_at: &str) -> RecurringRule {
        RecurringRule {
            id: "rule".into(),
            title: "test".into(),
            note: None,
            priority: 1,
            list_id: "work".into(),
            frequency: frequency.into(),
            interval_count: 1,
            weekdays: vec![],
            month_day: None,
            first_due_at: first_due_at.into(),
            next_due_at: Some(first_due_at.into()),
            timezone: "Asia/Shanghai".into(),
            generate_ahead_minutes: 0,
            remind_before: None,
            end_at: None,
            enabled: true,
            created_at: String::new(),
            updated_at: String::new(),
            deleted_at: None,
        }
    }

    #[test]
    fn monthly_clamps_to_last_day() {
        let mut value = rule("monthly", "2024-01-31T10:00:00Z");
        value.month_day = Some(31);
        assert_eq!(
            next_occurrence(&value, "2024-01-31T10:00:00Z").unwrap(),
            "2024-02-29T10:00:00Z"
        );
    }

    #[test]
    fn quarterly_crosses_year_boundary() {
        let mut value = rule("quarterly", "2024-11-30T10:00:00Z");
        value.month_day = Some(30);
        assert_eq!(
            next_occurrence(&value, "2024-11-30T10:00:00Z").unwrap(),
            "2025-02-28T10:00:00Z"
        );
    }

    #[test]
    fn weekly_supports_multiple_weekdays() {
        let mut value = rule("weekly", "2024-01-01T10:00:00Z");
        value.weekdays = vec![1, 5];
        assert_eq!(
            next_occurrence(&value, "2024-01-01T10:00:00Z").unwrap(),
            "2024-01-05T10:00:00Z"
        );
    }
}
