use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};

use crate::clock;
use crate::widget;

/// 托盘「设置」子菜单的面板直达项：(菜单 id 后缀, 显示文案)。
///
/// 后缀必须与前端 `SettingsPanelId`（`src/types/settings.ts`）逐字一致——
/// Rust 侧拼错不会报错，只会让前端静默退回默认面板；契约由本文件
/// `tray_settings_panels_match_frontend_contract` 单测与前端守卫共同兜住。
///
/// 顺序即菜单顺序：用户视角从「最常调」到「最少调」。
pub const SETTINGS_PANEL_ITEMS: &[(&str, &str)] = &[
    ("general", "常规"),
    ("appearance", "外观"),
    ("notifications", "提醒与通知"),
    ("sync", "同步"),
    ("data", "数据与备份"),
    ("about", "关于"),
];

/// 托盘「设置」子菜单项的 id 前缀；前端据 `settings:` 之后的部分解析面板。
const SETTINGS_ID_PREFIX: &str = "settings:";
/// 「检查更新」菜单项 id（前端与设置→关于共用同一套更新弹窗）。
const CHECK_UPDATE_ID: &str = "check-update";
/// 托盘意图事件：payload 为 `TrayIntent`。设置直达与检查更新走同一个事件，
/// 前端只需一处 listen，且与 `take_tray_intent` 的返回值形状完全一致。
const EVENT_TRAY_INTENT: &str = "tray-intent";

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 Torder", true, None::<&str>)?;
    let quick_add = MenuItem::with_id(app, "quick-add", "快速新建任务", true, None::<&str>)?;
    let widget_toggle = CheckMenuItem::with_id(
        app,
        "widget",
        "桌面小窗",
        true,
        widget::is_widget_visible(app.handle()),
        None::<&str>,
    )?;
    let clock_toggle = CheckMenuItem::with_id(
        app,
        "clock",
        "桌面时钟",
        true,
        clock::is_clock_visible(app.handle()),
        None::<&str>,
    )?;

    // 设置子菜单：面板直达项 + 一根分隔 + 检查更新。
    // 每次点击都「显示主窗 + 派发事件」：只显示窗口用户到不了设置页，
    // 只派发事件则窗口若已隐藏会毫无反应（详见 PendingTrayIntent 的兜底）。
    let mut settings_entries: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> =
        Vec::with_capacity(SETTINGS_PANEL_ITEMS.len() + 2);
    for (panel, label) in SETTINGS_PANEL_ITEMS {
        settings_entries.push(Box::new(MenuItem::with_id(
            app,
            format!("{SETTINGS_ID_PREFIX}{panel}"),
            *label,
            true,
            None::<&str>,
        )?));
    }
    settings_entries.push(Box::new(PredefinedMenuItem::separator(app)?));
    settings_entries.push(Box::new(MenuItem::with_id(
        app,
        CHECK_UPDATE_ID,
        "检查更新",
        true,
        None::<&str>,
    )?));
    let settings_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = settings_entries
        .iter()
        .map(|item| item.as_ref())
        .collect();
    let settings_menu = Submenu::with_items(app, "设置", true, &settings_refs)?;
    // 托管暂存槽：托盘点击时前端可能还没挂载，意图先存这里等前端来取。
    app.manage(TrayIntentSlot::default());

    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &quick_add,
            &widget_toggle,
            &clock_toggle,
            &separator,
            &settings_menu,
            &quit,
        ],
    )?;
    // 托管一份 Menu 句柄，供 set_widget_menu_checked / set_clock_menu_checked 同步勾选态
    app.manage(menu.clone());

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Torder（今序）")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id() == "open" {
                show_main_window(app);
            } else if event.id() == "quick-add" {
                show_main_window(app);
                let _ = app.emit("tray-quick-add", ());
            } else if event.id() == "widget" {
                match widget::toggle_widget_window(app) {
                    Ok(visible) => set_widget_menu_checked(app, visible),
                    Err(error) => eprintln!("widget toggle failed: {error}"),
                }
            } else if event.id() == "clock" {
                match clock::toggle_clock_window(app) {
                    Ok(visible) => set_clock_menu_checked(app, visible),
                    Err(error) => eprintln!("clock toggle failed: {error}"),
                }
            } else if event.id() == "quit" {
                app.exit(0);
            } else if event.id() == CHECK_UPDATE_ID {
                dispatch_intent(app, TrayIntent::CheckUpdate);
            } else if let Some(panel) = settings_panel_from_id(event.id().as_ref()) {
                dispatch_intent(app, TrayIntent::OpenSettings { panel });
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    app.manage(tray);

    if let Some(window) = app.get_webview_window("main") {
        let window_to_hide = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window_to_hide.hide();
            }
        });
    }

    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 托盘意图：前端挂载晚于托盘点击时，靠它补发一次（见 `remember_intent`）。
///
/// 序列化形状对齐 `models.rs` 的 camelCase 约定，前端按
/// `{ kind: "openSettings", panel } | { kind: "checkUpdate" }` 判别联合解析。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrayIntent {
    OpenSettings { panel: String },
    CheckUpdate,
}

/// 暂存最后一次托盘意图，供前端就绪后消费。
///
/// 事件本身不保证送达：`--silent` 冷启动时前端可能还没注册 listen，托盘点击
/// 已经发生，事件就此丢失（用户看到窗口弹出却停在默认页）。这里把意图留一份，
/// 前端挂载后调 `take_tray_intent` 取走——取到就补做，取不到说明事件已送达。
///
/// `ready` 用来划清两段：前端就绪**前**点击要暂存（事件可能丢），就绪**后**
/// 点击只走事件。少了这道闸，暂存项会一直留到下次挂载，造成「设置弹窗自己弹出来」
/// 的幽灵重放；有了它，同一份意图只会被消费一次。
#[derive(Default)]
pub struct TrayIntentSlot {
    ready: std::sync::atomic::AtomicBool,
    pending: std::sync::Mutex<Option<TrayIntent>>,
}

/// 派发托盘意图：显示主窗 + 提交事件（就绪前额外暂存一份兜底）。
fn dispatch_intent(app: &AppHandle, intent: TrayIntent) {
    show_main_window(app);
    let slot = app.state::<TrayIntentSlot>();
    if !slot.ready.load(std::sync::atomic::Ordering::SeqCst) {
        if let Ok(mut pending) = slot.pending.lock() {
            *pending = Some(intent.clone());
        }
    }
    let _ = app.emit(EVENT_TRAY_INTENT, intent);
}

/// 前端挂载完成、listener 已就位后调用：标记就绪并取走暂存意图。
///
/// 返回 `Some` 表示「事件没送达，请补做一次」；`None` 表示无事可做。
/// 幂等：就绪后再次调用必然拿到 `None`。
#[tauri::command]
pub fn take_tray_intent(state: tauri::State<'_, TrayIntentSlot>) -> Option<TrayIntent> {
    state
        .ready
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let Ok(mut pending) = state.pending.lock() else {
        return None;
    };
    pending.take()
}

/// 从菜单 id 解析设置面板 key（`settings:sync` → `Some("sync")`）。
///
/// 面板合法性不在 Rust 侧校验：`SettingsPanelId` 的权威定义在前端
/// （`src/types/settings.ts`），这里只做前缀切分，白名单由前端守卫兜住。
pub fn settings_panel_from_id(id: &str) -> Option<String> {
    id.strip_prefix(SETTINGS_ID_PREFIX)
        .filter(|panel| !panel.is_empty())
        .map(str::to_owned)
}

/// 同步托盘"桌面小窗"菜单项的勾选态（托盘点击、设置面板开关、启动时都会调用）。
pub fn set_widget_menu_checked(app: &AppHandle, checked: bool) {
    use tauri::menu::MenuItemKind;

    let Some(menu) = app.try_state::<tauri::menu::Menu<tauri::Wry>>() else {
        return;
    };
    if let Some(MenuItemKind::Check(item)) = menu.get("widget") {
        let _ = item.set_checked(checked);
    }
}

/// 同步托盘"桌面时钟"菜单项的勾选态（托盘点击、设置面板开关、启动时都会调用）。
pub fn set_clock_menu_checked(app: &AppHandle, checked: bool) {
    use tauri::menu::MenuItemKind;

    let Some(menu) = app.try_state::<tauri::menu::Menu<tauri::Wry>>() else {
        return;
    };
    if let Some(MenuItemKind::Check(item)) = menu.get("clock") {
        let _ = item.set_checked(checked);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rust 侧的菜单 id 与前端 `SettingsPanelId` 是字符串契约，拼错不会报错、
    /// 只会让前端静默退回默认面板。这里把「Rust 发出什么」钉死，前端
    /// `isSettingsPanelId` 守卫负责「接受什么」，两头对不上时至少有一侧测试失败。
    #[test]
    fn tray_settings_panels_match_frontend_contract() {
        // 与 src/types/settings.ts 的 SettingsPanelId 逐字对齐（顺序无关）。
        const FRONTEND_PANEL_IDS: &[&str] = &[
            "general",
            "appearance",
            "defaults",
            "notifications",
            "sync",
            "data",
            "shortcuts",
            "about",
        ];

        for (panel, _label) in SETTINGS_PANEL_ITEMS {
            assert!(
                FRONTEND_PANEL_IDS.contains(panel),
                "托盘面板 id `{panel}` 不在前端 SettingsPanelId 白名单内"
            );
        }
    }

    #[test]
    fn settings_panel_from_id_strips_prefix_only() {
        assert_eq!(
            settings_panel_from_id("settings:sync").as_deref(),
            Some("sync")
        );
        // 未知面板不在 Rust 侧拦截：白名单权威在前端，这里只做前缀切分。
        assert_eq!(
            settings_panel_from_id("settings:unknown").as_deref(),
            Some("unknown")
        );
        assert_eq!(settings_panel_from_id("settings:"), None);
        assert_eq!(settings_panel_from_id("check-update"), None);
        assert_eq!(settings_panel_from_id("quick-add"), None);
    }

    #[test]
    fn settings_menu_ids_are_unique_and_prefixed() {
        let mut seen = std::collections::HashSet::new();
        for (panel, _label) in SETTINGS_PANEL_ITEMS {
            let id = format!("{SETTINGS_ID_PREFIX}{panel}");
            assert!(seen.insert(id.clone()), "重复的托盘菜单 id: {id}");
        }
        // 前缀本身不能是面板 id 的前缀歧义源：`settings:` 必须严格分隔。
        for (panel, _label) in SETTINGS_PANEL_ITEMS {
            assert!(!panel.starts_with(':'), "面板 id 不应以冒号开头: {panel}");
            assert!(!panel.is_empty());
        }
    }

    /// 暂存槽的两段语义：就绪前点击要留下兜底，就绪后点击不再留。
    /// 这条锁住「幽灵重放」回归——暂存项若在就绪后仍被写入，下次启动会凭空弹设置。
    #[test]
    fn intent_slot_stashes_only_before_ready() {
        use std::sync::atomic::Ordering;

        let slot = TrayIntentSlot::default();

        // 就绪前：手动模拟 dispatch_intent 的暂存分支。
        assert!(!slot.ready.load(Ordering::SeqCst));
        *slot.pending.lock().unwrap() = Some(TrayIntent::CheckUpdate);

        // 就绪后取走兜底，且槽位清空。
        let taken = slot.pending.lock().unwrap().take();
        assert_eq!(taken, Some(TrayIntent::CheckUpdate));
        assert_eq!(slot.pending.lock().unwrap().take(), None);

        // 就绪后不再暂存：模拟前端已 ready 的 dispatch 分支。
        slot.ready.store(true, Ordering::SeqCst);
        if !slot.ready.load(Ordering::SeqCst) {
            *slot.pending.lock().unwrap() = Some(TrayIntent::CheckUpdate);
        }
        assert_eq!(
            slot.pending.lock().unwrap().take(),
            None,
            "就绪后的点击不应再写入暂存槽，否则下次挂载会幽灵重放"
        );
    }

    /// 序列化形状必须与前端判别联合逐字对齐（前端按 `kind` 分支）。
    #[test]
    fn tray_intent_serializes_as_tagged_union() {
        let open = serde_json::to_string(&TrayIntent::OpenSettings {
            panel: "sync".to_owned(),
        })
        .unwrap();
        assert_eq!(open, r#"{"kind":"openSettings","panel":"sync"}"#);

        let update = serde_json::to_string(&TrayIntent::CheckUpdate).unwrap();
        assert_eq!(update, r#"{"kind":"checkUpdate"}"#);
    }
}
