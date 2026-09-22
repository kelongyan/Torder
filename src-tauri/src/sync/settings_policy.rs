//! 设置项的跨设备同步策略。
//!
//! ## 为什么不是「整张 settings 表同步」
//!
//! `settings` 表里混着三种性质完全不同的数据：
//!  - **偏好**：主题、强调色、默认视图……跨设备一致才合理；
//!  - **设备私有**：`launchAtStartup`（每台机器是否开机自启是独立的）、
//!    `widget`/`clock` 的 `x/y/w/h`（那台机器上的屏幕坐标，同步过去会在
//!    另一块显示器上乱飞）；
//!  - **运行时状态**：`focusDndUntil`（免打扰截止时刻）、`sync*` 系列
//!    （同步自身的账本）。
//!
//! 所以这里用**白名单**：只有明确列出的键才进同步。新增设置项默认不同步，
//! 需要有人主动判断它是否该跨设备，再补进白名单——这个默认方向是刻意的，
//! 漏同步只是功能少一点，误同步会把别人的机器配置搞乱。
//!
//! ## 为什么 `widget` / `clock` 要拆字段
//!
//! 它们各自是一个 JSON 对象，外观偏好（`noteTheme`、`noteFont`、便签主题…）
//! 该同步，几何与开关不该。整键同步会让便签在新设备上按旧坐标弹出；
//! 整键跳过又会让用户重装后外观全丢。所以按字段拆：白名单里的字段进同步，
//! 其余在打包时剔除、在应用时保留本地值。

use serde_json::{Map, Value};

/// 整键同步的设置：值本身就是纯偏好，直接原样同步。
pub const SYNCED_SETTING_KEYS: &[&str] = &[
    "theme",
    "accent",
    "density",
    "defaultView",
    "defaultListId",
    "defaultDueDate",
    "defaultPriority",
    "defaultReminderMinutes",
    "savedViews",
    "trashRetentionDays",
    "backupRetentionCount",
    "notificationsEnabled",
    "notificationSound",
    "reviewReminderEnabled",
    "reviewReminderTime",
    "autoPostponeOverdue",
    "focusDndEnabled",
    "moveCompletedImmediately",
    "quickAddNaturalLanguage",
];

/// 需要按字段拆分的设置：值为 JSON 对象，只有列出的字段参与同步。
///
/// 刻意排除的字段（**不要**加进来）：
///  - `x` / `y` / `w` / `h`：屏幕坐标与窗口尺寸，每台机器独立；
///  - `locked`：便签锁定是本地摆放习惯；
///  - `enabled`：新设备是否默认弹出便签，应由用户在那台机器上决定；
///  - `anchorDate`：跟随今天/固定日期是便签自身的状态。
pub const SYNCED_OBJECT_FIELDS: &[(&str, &[&str])] = &[
    (
        "widget",
        &[
            "noteTheme",
            "noteGlassOpacity",
            "noteFont",
            "noteFontSize",
            "noteTexture",
            "noteRules",
            "notePin",
            "noteDots",
            "noteHideDone",
            "noteDblEdit",
        ],
    ),
    ("clock", &["glass", "showSeconds", "format", "theme"]),
];

/// 该设置键是否参与同步（整键或按字段均算）。
pub fn is_synced_key(key: &str) -> bool {
    SYNCED_SETTING_KEYS.contains(&key) || SYNCED_OBJECT_FIELDS.iter().any(|(k, _)| *k == key)
}

/// 按字段同步的键对应的字段白名单；非此类键返回 `None`。
fn synced_fields_for(key: &str) -> Option<&'static [&'static str]> {
    SYNCED_OBJECT_FIELDS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, fields)| *fields)
}

/// 把本地设置值裁剪成「可同步的形态」。
///
/// - 整键同步（如 `theme`）：原样返回；
/// - 按字段同步（如 `widget`）：只保留白名单字段，其余剔除；
/// - 不在同步范围：返回 `None`（调用方应跳过，不产生变更记录）。
///
/// 值为 JSON 字符串（`settings.value` 列存的就是 JSON 文本），此处接收已解析的
/// `Value`；解析失败由调用方按「非法设置」处理。
pub fn project_for_sync(key: &str, value: &Value) -> Option<Value> {
    if SYNCED_SETTING_KEYS.contains(&key) {
        return Some(value.clone());
    }
    let fields = synced_fields_for(key)?;
    let Some(object) = value.as_object() else {
        // 按字段同步的键存了非对象值：数据异常，宁可不同步也不猜
        return None;
    };
    let mut projected = Map::new();
    for field in fields {
        if let Some(field_value) = object.get(*field) {
            projected.insert((*field).to_owned(), field_value.clone());
        }
    }
    Some(Value::Object(projected))
}

/// 把远端同步来的值合并进本地设置值。
///
/// - 整键同步：远端值直接覆盖本地；
/// - 按字段同步：**只覆盖白名单字段**，本地其余字段（坐标、开关等）保持不动。
///
/// 返回合并后的完整值，供调用方写回 `settings` 表。
pub fn merge_remote_into_local(key: &str, local: Option<&Value>, remote: &Value) -> Option<Value> {
    if SYNCED_SETTING_KEYS.contains(&key) {
        return Some(remote.clone());
    }
    let fields = synced_fields_for(key)?;
    let remote_object = remote.as_object()?;
    let mut merged = local
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(Map::new);
    for field in fields {
        if let Some(field_value) = remote_object.get(*field) {
            merged.insert((*field).to_owned(), field_value.clone());
        }
    }
    Some(Value::Object(merged))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn whole_key_settings_pass_through_unchanged() {
        let value = json!("dark");
        assert_eq!(project_for_sync("theme", &value), Some(value.clone()));
        assert_eq!(
            merge_remote_into_local("theme", Some(&json!("light")), &value),
            Some(value)
        );
    }

    /// 设备私有键必须被排除——这是整个白名单设计的存在理由。
    #[test]
    fn device_private_keys_are_not_synced() {
        for key in [
            "launchAtStartup",  // 每台机器独立
            "focusDndUntil",    // 运行时状态
            "syncStatus",       // 同步自身账本
            "syncAutoEnabled",
            "autoBackup",
            "fontScale",        // 未在清单里的未知键
        ] {
            assert!(
                !is_synced_key(key),
                "{key} 不该被同步（设备私有或运行时状态）"
            );
            assert_eq!(project_for_sync(key, &json!("anything")), None);
        }
    }

    #[test]
    fn widget_projects_only_appearance_fields() {
        let local = json!({
            "enabled": true,
            "x": 801, "y": 433, "w": 520, "h": 281,
            "locked": false,
            "anchorDate": null,
            "noteTheme": "glass",
            "noteFont": "微软雅黑",
            "noteDots": false,
        });
        let projected = project_for_sync("widget", &local).unwrap();
        let object = projected.as_object().unwrap();
        // 外观字段在
        assert_eq!(object.get("noteTheme").unwrap(), &json!("glass"));
        assert_eq!(object.get("noteFont").unwrap(), &json!("微软雅黑"));
        assert_eq!(object.get("noteDots").unwrap(), &json!(false));
        // 几何与开关都不在——同步过去会在另一台机器上乱飞
        for excluded in ["x", "y", "w", "h", "enabled", "locked", "anchorDate"] {
            assert!(
                !object.contains_key(excluded),
                "{excluded} 不该出现在同步载荷里"
            );
        }
    }

    /// 合并远端时，本地几何必须原样保留——只吃白名单字段。
    #[test]
    fn merge_keeps_local_geometry_intact() {
        let local = json!({
            "enabled": true, "x": 100, "y": 200, "w": 300, "h": 400,
            "noteTheme": "sky",
        });
        let remote = json!({ "noteTheme": "glass", "noteFont": "Arial" });
        let merged = merge_remote_into_local("widget", Some(&local), &remote).unwrap();
        let object = merged.as_object().unwrap();
        assert_eq!(object.get("noteTheme").unwrap(), &json!("glass"));
        assert_eq!(object.get("noteFont").unwrap(), &json!("Arial"));
        // 本地几何与开关原封不动——远端根本没带着它们，也不该被清掉
        assert_eq!(object.get("x").unwrap(), &json!(100));
        assert_eq!(object.get("y").unwrap(), &json!(200));
        assert_eq!(object.get("w").unwrap(), &json!(300));
        assert_eq!(object.get("h").unwrap(), &json!(400));
        assert_eq!(object.get("enabled").unwrap(), &json!(true));
    }

    /// 远端带了几何字段（旧版客户端/被篡改的载荷）也必须忽略。
    #[test]
    fn merge_ignores_remote_geometry_even_if_present() {
        let local = json!({ "x": 100, "y": 200, "noteTheme": "sky" });
        let remote = json!({ "noteTheme": "glass", "x": 9999, "y": 9999, "enabled": true });
        let merged = merge_remote_into_local("widget", Some(&local), &remote).unwrap();
        let object = merged.as_object().unwrap();
        assert_eq!(object.get("x").unwrap(), &json!(100), "远端坐标必须被忽略");
        assert_eq!(object.get("y").unwrap(), &json!(200), "远端坐标必须被忽略");
        assert_eq!(object.get("noteTheme").unwrap(), &json!("glass"));
        assert!(!object.contains_key("enabled"), "远端不该能塞进 enabled");
    }

    #[test]
    fn merge_into_missing_local_starts_from_remote_subset() {
        let remote = json!({ "noteTheme": "glass", "x": 9999 });
        let merged = merge_remote_into_local("widget", None, &remote).unwrap();
        let object = merged.as_object().unwrap();
        assert_eq!(object.get("noteTheme").unwrap(), &json!("glass"));
        assert!(!object.contains_key("x"), "首次合并也不该带入几何");
    }

    #[test]
    fn non_object_value_for_field_scoped_key_is_not_synced() {
        // widget 存了个字符串（数据损坏）：宁可不传，也别把脏值扩散到别的设备
        assert_eq!(project_for_sync("widget", &json!("broken")), None);
        assert_eq!(merge_remote_into_local("widget", None, &json!("broken")), None);
    }

    #[test]
    fn unknown_key_is_never_synced() {
        assert_eq!(project_for_sync("someFutureSetting", &json!(1)), None);
        assert!(!is_synced_key("someFutureSetting"));
    }
}
