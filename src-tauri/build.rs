fn main() {
    #[cfg(target_os = "macos")]
    {
        use swift_rs::SwiftLinker;
        // Link Swift runtime and compile Swift sources
        SwiftLinker::new("10.15")
            .with_package("EventKitBridge", "./src-swift/")
            .link();
    }

    tauri_build::build()
}
