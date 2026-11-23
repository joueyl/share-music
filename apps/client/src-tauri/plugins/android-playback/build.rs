fn main() {
    tauri_plugin::Builder::new(&["operate"])
        .android_path("android")
        .build();
}
