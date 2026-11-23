import Foundation

/// Non-secret preferences. The API token is deliberately NOT here (R-SEC-11).
public struct BridgeSettings: Equatable {
    public var serverURL: String
    public var containerID: String
    public var syncEnabled: Bool
    public var paused: Bool

    public init(serverURL: String = "", containerID: String = "", syncEnabled: Bool = false, paused: Bool = false) {
        self.serverURL = serverURL
        self.containerID = containerID
        self.syncEnabled = syncEnabled
        self.paused = paused
    }
}

public final class SettingsStore {
    enum Key {
        static let serverURL = "serverURL"
        static let containerID = "containerID"
        static let syncEnabled = "syncEnabled"
        static let paused = "paused"
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func load() -> BridgeSettings {
        BridgeSettings(
            serverURL: defaults.string(forKey: Key.serverURL) ?? "",
            containerID: defaults.string(forKey: Key.containerID) ?? "",
            syncEnabled: defaults.bool(forKey: Key.syncEnabled),
            paused: defaults.bool(forKey: Key.paused)
        )
    }

    public func save(_ s: BridgeSettings) {
        defaults.set(s.serverURL, forKey: Key.serverURL)
        defaults.set(s.containerID, forKey: Key.containerID)
        defaults.set(s.syncEnabled, forKey: Key.syncEnabled)
        defaults.set(s.paused, forKey: Key.paused)
    }
}
