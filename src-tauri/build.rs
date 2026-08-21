use std::fs;

fn main() {
    println!("cargo:rerun-if-changed=tauri.android.conf.json");
    if let Ok(config) = fs::read_to_string("tauri.android.conf.json") {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config) {
            if let Some(version) = config.get("version").and_then(|value| value.as_str()) {
                println!("cargo:rustc-env=TORDER_ANDROID_VERSION={version}");
            }
        }
    }
    tauri_build::build()
}
