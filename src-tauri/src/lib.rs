mod commands;
mod db;
mod ics;
mod models;

use std::sync::Mutex;
use tauri::Manager;

/// Estado global de la app: una única conexión SQLite gestionada vía `manage`,
/// protegida por un `Mutex` (sin runtime async, §5).
pub struct AppState {
    pub conn: Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let conn = db::open_db(&app_data_dir)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(AppState {
                conn: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_work_formats,
            commands::list_shift_templates,
            commands::create_shift_template,
            commands::update_shift_template,
            commands::delete_shift_template,
            commands::list_assignments,
            commands::create_assignment,
            commands::create_assignments_range,
            commands::update_assignment,
            commands::delete_assignment,
            commands::get_settings,
            commands::set_setting,
            commands::get_calendar_month,
            commands::get_calendar_week,
            commands::export_calendar_ics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
