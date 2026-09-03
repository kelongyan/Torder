//! P2-01 共享查询向量 · Rust 侧消费。
//!
//! 与前端 `src/services/taskQueryVectors.test.ts` 消费同一份
//! `src/services/__fixtures__/task-query-vectors.json`，锁定
//! task_repository::query 与前端 taskQuery 的查询语义一致。
//! 新增/修改查询语义：先更新向量文件，再保证两端测试通过。
//!
//! 日期占位约定（见向量 _dateAnchor）：scheduledDate 支持 $today/$yesterday/$tomorrow，
//! dueAt 支持 $todayNoon/$yesterdayNoon/$tomorrowNoon。本测试从 SQLite
//! date('now','localtime') 读取「今天」作为锚（与前端运行当天同源，两端须同日运行）；
//! noon 系列渲染为 `{今天}T04:00:00Z`（约定测试机时区 UTC+8：本地正午 = 04:00Z，
//! date(x,'localtime') 后仍落在本地当天）。

#![cfg(test)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use rusqlite::{params, Connection};
use serde_json::{Map, Value};

use super::database::Database;
use super::task_repository::TaskRepository;
use crate::models::TaskQueryInput;

const VECTORS_JSON: &str =
    include_str!("../../../src/services/__fixtures__/task-query-vectors.json");

static DB_SEQ: AtomicU32 = AtomicU32::new(0);

fn temp_database_path() -> PathBuf {
    let seq = DB_SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("torder-qv-{}-{}.db", std::process::id(), seq))
}

fn cleanup_database(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(PathBuf::from(format!("{}{}", path.display(), suffix)));
    }
}

/// 从数据库读取本地「今天」及前后一天的日期键（与 SQL 查询同一时区语义）。
fn date_anchors(connection: &Connection) -> (String, String, String) {
    connection
        .query_row(
            "SELECT date('now','localtime'), date('now','-1 day','localtime'), date('now','+1 day','localtime')",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .expect("read date anchors")
}

fn str_of<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(Value::as_str)
}

fn str_or<'a>(map: &'a Map<String, Value>, key: &str, default: &'a str) -> &'a str {
    str_of(map, key).unwrap_or(default)
}

fn int_or(map: &Map<String, Value>, key: &str, default: i64) -> i64 {
    map.get(key).and_then(Value::as_i64).unwrap_or(default)
}

fn bool_or(map: &Map<String, Value>, key: &str, default: bool) -> bool {
    map.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// JSON 任务的 camelCase 字段渲染成 SQL 值（含日期占位展开）。
fn insert_task(connection: &Connection, raw: &Value, today: &str, yesterday: &str, tomorrow: &str) {
    let o = raw.as_object().expect("task must be object");

    // scheduledDate 占位（date key）；dueAt noon 占位（UTC+8 正午）。
    let scheduled_date = str_of(o, "scheduledDate").map(|value| match value {
        "$today" => today.to_owned(),
        "$yesterday" => yesterday.to_owned(),
        "$tomorrow" => tomorrow.to_owned(),
        other => other.to_owned(),
    });
    let due_at = str_of(o, "dueAt").map(|value| match value {
        "$todayNoon" => format!("{today}T04:00:00Z"),
        "$yesterdayNoon" => format!("{yesterday}T04:00:00Z"),
        "$tomorrowNoon" => format!("{tomorrow}T04:00:00Z"),
        other => other.to_owned(),
    });

    let created_at = str_or(o, "createdAt", "2026-07-01T00:00:00Z");
    let tags = o
        .get("tags")
        .and_then(Value::as_array)
        .map(|arr| serde_json::to_string(arr).expect("tags serializable"))
        .unwrap_or_else(|| "[]".to_owned());

    connection
        .execute(
            r#"
            INSERT INTO tasks (
                id, title, note, status, priority, list_id, scheduled_date, due_at,
                completed_at, sort_order, subtasks, tags, created_at, updated_at, deleted_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '[]', ?11, ?12, ?12, ?13)
            "#,
            params![
                str_or(o, "id", ""),
                str_or(o, "title", "未命名"),
                str_of(o, "note"),
                str_or(o, "status", "todo"),
                int_or(o, "priority", 0),
                str_or(o, "listId", "work"),
                scheduled_date,
                due_at,
                str_of(o, "completedAt"),
                int_or(o, "sortOrder", 0),
                tags,
                created_at,
                str_of(o, "deletedAt"),
            ],
        )
        .expect("insert vector task");
}

fn run_case(case: &Value) {
    let case_obj = case.as_object().expect("case must be object");
    let name = str_or(case_obj, "name", "(unnamed)");

    let path = temp_database_path();
    let database = Database::initialize(path.clone()).expect("initialize temp database");
    let connection = database.connect().expect("connect");

    let (today, yesterday, tomorrow) = date_anchors(&connection);

    let tasks = case_obj["tasks"].as_array().expect("case.tasks array");
    for task in tasks {
        insert_task(&connection, task, &today, &yesterday, &tomorrow);
    }

    let input_obj = case_obj["input"]
        .as_object()
        .expect("case.input must be object");
    let input = TaskQueryInput {
        scope_kind: str_or(input_obj, "scopeKind", "view").to_owned(),
        scope_value: str_or(input_obj, "scopeValue", "").to_owned(),
        query: str_of(input_obj, "query").map(str::to_owned),
        sort_by: Some(str_or(input_obj, "sortBy", "priority").to_owned()),
        show_completed: bool_or(input_obj, "showCompleted", false),
    };

    let repository = TaskRepository::new(&database);
    let ids: Vec<String> = repository
        .query(input)
        .expect("repository query")
        .into_iter()
        .map(|task| task.id)
        .collect();

    let expected: Vec<String> = case_obj["expectIds"]
        .as_array()
        .expect("expectIds array")
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();

    drop(connection);
    cleanup_database(&path);

    assert_eq!(ids, expected, "向量用例失败: {name}");
}

#[test]
fn rust_query_matches_shared_query_vectors() {
    let root: Value = serde_json::from_str(VECTORS_JSON).expect("vectors JSON valid");
    let cases = root["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty(), "vectors must not be empty");
    for case in cases {
        run_case(case);
    }
}
