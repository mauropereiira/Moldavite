// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-calendar",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "tauri-plugin-calendar", type: .static, targets: ["CalendarPlugin"])
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        // Not imported: linking it puts the bridge's C symbols where Rust's `extern` block finds them.
        .package(name: "EventKitBridge", path: "../../../src-swift")
    ],
    targets: [
        .target(name: "CalendarPlugin", dependencies: ["Tauri", "EventKitBridge"], path: "Sources")
    ]
)
