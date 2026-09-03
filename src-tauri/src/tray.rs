use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};

use crate::widget;

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
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick_add, &widget_toggle, &separator, &quit])?;
    // 托管一份 Menu 句柄，供 set_widget_menu_checked 同步勾选态
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
            } else if event.id() == "quit" {
                app.exit(0);
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
