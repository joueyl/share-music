fn main() {
    tauri_plugin::Builder::new(&["can_remember_login", "load_saved_login", "save_login", "clear_saved_login"])
        .android_path("android")
        .build();
}
