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
        // enumeratorForChangeHistoryFetchRequest:error: is NS_SWIFT_UNAVAILABLE (ADR-0008): tiny Objective-C shim.
        .target(name: "CHShim", path: "Sources/CHShim", linkerSettings: [.linkedFramework("Contacts")]),
        .target(name: "BridgeCore", dependencies: ["CHShim"], path: "Sources/BridgeCore"),
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
