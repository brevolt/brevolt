import Foundation

/// Minimal local state (R-BR-4): the Contacts history token. Not a secret.
public protocol CheckpointStore: AnyObject {
    var historyToken: Data? { get set }
}

public final class DefaultsCheckpointStore: CheckpointStore {
    private let defaults: UserDefaults
    private static let key = "historyToken"
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    public var historyToken: Data? {
        get { defaults.data(forKey: Self.key) }
        set { if let newValue { defaults.set(newValue, forKey: Self.key) } else { defaults.removeObject(forKey: Self.key) } }
    }
}
