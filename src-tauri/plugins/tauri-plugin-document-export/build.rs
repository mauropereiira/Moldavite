fn main() {
    // Only Rust may submit an app-generated file to the native picker.
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();
}
