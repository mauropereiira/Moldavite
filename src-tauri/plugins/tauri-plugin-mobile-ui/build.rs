fn main() {
    tauri_plugin::Builder::new(&["set_appearance"])
        .ios_path("ios")
        .build();
}
