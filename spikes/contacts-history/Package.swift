// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "contacts-history",
    platforms: [.macOS(.v13)],
    targets: [
        // enumeratorForChangeHistoryFetchRequest:error: is NS_SWIFT_UNAVAILABLE,
        // so history reads go through a tiny Objective-C shim.
        .target(name: "CHShim", path: "Sources/CHShim", linkerSettings: [.linkedFramework("Contacts")]),
        .executableTarget(name: "contacts-history", dependencies: ["CHShim"], path: "Sources/contacts-history"),
    ]
)
