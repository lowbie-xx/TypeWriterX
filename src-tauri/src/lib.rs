use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Files the OS asked us to open before the front end was ready to receive them.
#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_binary_file(path: String, base64: String) -> Result<(), String> {
    let bytes = STANDARD.decode(base64).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpen::default())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            write_binary_file,
            take_pending_open
        ])
        .build(tauri::generate_context!())
        .expect("error while building TypeWriterX");

    app.run(|_handle, _event| {
        // macOS delivers "Open With…" / double-clicked documents as an Opened event.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if let Some(state) = _handle.try_state::<PendingOpen>() {
                state.0.lock().unwrap().extend(paths.clone());
            }
            let _ = _handle.emit("open-files", paths);
        }
    });
}
