// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-document-export",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "tauri-plugin-document-export", type: .static, targets: ["tauri-plugin-document-export"])
    ],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-document-export", dependencies: ["Tauri"], path: "Sources")]
)
