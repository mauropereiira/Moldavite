// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "MoldaviteCloud",
    platforms: [.iOS(.v14), .macOS(.v10_15)],
    products: [.library(name: "MoldaviteCloud", targets: ["MoldaviteCloud"])],
    targets: [
        .target(name: "MoldaviteCloud"),
        .testTarget(name: "MoldaviteCloudTests", dependencies: ["MoldaviteCloud"])
    ]
)
