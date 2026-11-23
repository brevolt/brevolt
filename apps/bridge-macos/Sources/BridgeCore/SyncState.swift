import Foundation

public enum SyncStatus: Equatable {
    case notConfigured, synced, pending, paused, error(String)
}

/// Pure state for the menu bar: what the icon and menu show.
public struct SyncState: Equatable {
    public var status: SyncStatus = .notConfigured
    public var lastSync: Date?
    public var pendingCount: Int = 0

    public init() {}

    public static func resolve(settings: BridgeSettings, hasToken: Bool) -> SyncStatus {
        if settings.serverURL.isEmpty || !hasToken { return .notConfigured }
        if settings.paused { return .paused }
        return settings.syncEnabled ? .pending : .notConfigured
    }
}

/// Contacts permission is requested only when sync is turned on (never at launch).
public protocol ContactsAccess {
    func requestAccess() async -> Bool
}

public struct SyncToggle {
    private let access: ContactsAccess
    public init(access: ContactsAccess) { self.access = access }

    /// Returns the effective `syncEnabled` value: enabling requires Contacts access.
    public func setEnabled(_ enabled: Bool) async -> Bool {
        guard enabled else { return false }
        return await access.requestAccess()
    }
}
