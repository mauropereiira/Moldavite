fn main() {
    // Rust calls the native bridge. No frontend plugin commands are exposed.
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();
}
