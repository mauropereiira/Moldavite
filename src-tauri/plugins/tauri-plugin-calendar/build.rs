fn main() {
    // The builder watches only `ios/`; the EventKit bridge it links lives outside it.
    println!("cargo:rerun-if-changed=../../src-swift/Sources");
    println!("cargo:rerun-if-changed=../../src-swift/Package.swift");
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();
}
