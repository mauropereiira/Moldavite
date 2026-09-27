// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-mobile-ui",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "tauri-plugin-mobile-ui", type: .static, targets: ["tauri-plugin-mobile-ui"])
    ],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-mobile-ui", dependencies: ["Tauri"], path: "Sources")]
)
