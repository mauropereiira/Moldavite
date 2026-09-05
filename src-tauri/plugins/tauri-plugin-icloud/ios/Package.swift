// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-icloud",
    platforms: [.iOS(.v14), .macOS(.v10_15)],
    products: [
        .library(name: "tauri-plugin-icloud", type: .static, targets: ["ICloudPlugin"])
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        .package(name: "MoldaviteCloud", path: "Core")
    ],
    targets: [
        .target(name: "ICloudPlugin", dependencies: ["Tauri", "MoldaviteCloud"], path: "Sources")
    ]
)
