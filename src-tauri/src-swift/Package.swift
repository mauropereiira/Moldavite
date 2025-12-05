// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "EventKitBridge",
    platforms: [
        .macOS(.v10_15)
    ],
    products: [
        .library(
            name: "EventKitBridge",
            type: .static,
            targets: ["EventKitBridge"]
        )
    ],
    targets: [
        .target(
            name: "EventKitBridge",
            dependencies: [],
            path: "Sources/EventKitBridge"
        )
    ]
)
