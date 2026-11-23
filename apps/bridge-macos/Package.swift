// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "bridge-macos",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "BrevoltBridge", targets: ["BrevoltBridge"]),
    ],
    targets: [
        // Testable logic: settings, Keychain token storage, HTTP client, sync state.
        .target(name: "BridgeCore", path: "Sources/BridgeCore"),
        // Menu bar UI (SwiftUI).
        .executableTarget(name: "BrevoltBridge", dependencies: ["BridgeCore"], path: "Sources/BrevoltBridge"),
        .testTarget(
            name: "BridgeCoreTests",
            dependencies: ["BridgeCore"],
            path: "Tests/BridgeCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
