fn main() {
    tauri_plugin::Builder::new(&[
        "operate",
        "room_connect",
        "room_receive",
        "room_send",
        "room_close",
    ])
    .android_path("android")
    .build();
}
