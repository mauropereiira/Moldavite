fn main() {
    // `semantic_runtime` marks the targets that compile the ONNX runtime
    // behind `fastembed`. Keep in step with the fastembed target section in
    // Cargo.toml: Intel macOS has no prebuilt runtime and mobile leaves it
    // out for app size.
    println!("cargo::rustc-check-cfg=cfg(semantic_runtime)");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let intel_mac = target_os == "macos" && target_arch == "x86_64";
    let mobile = target_os == "ios" || target_os == "android";
    if !intel_mac && !mobile {
        println!("cargo::rustc-cfg=semantic_runtime");
    }

    // The Swift package is compiled by the host, so the attribute alone would
    // also build it for an iOS target from a Mac. The EventKit bridge is
    // macOS-shaped and `calendar::apple` is gated on the target, so only link
    // it when the target is macOS too.
    #[cfg(target_os = "macos")]
    if target_os == "macos" {
        use swift_rs::SwiftLinker;
        // Link Swift runtime and compile Swift sources
        SwiftLinker::new("10.15")
            .with_package("EventKitBridge", "./src-swift/")
            .with_package("MoldaviteCloud", "./plugins/tauri-plugin-icloud/ios/Core/")
            .link();
    }

    tauri_build::build()
}
