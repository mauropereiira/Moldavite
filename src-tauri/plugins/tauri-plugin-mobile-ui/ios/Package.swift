// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-mobile-ui",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "tauri-plugin-mobile-ui", type: .static, targets: ["MobileUiPlugin"])
    ],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "MobileUiPlugin", dependencies: ["Tauri"], path: "Sources")]
)
