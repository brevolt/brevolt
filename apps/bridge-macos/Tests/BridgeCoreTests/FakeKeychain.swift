import Foundation
import BridgeCore

final class FakeKeychain: SecretStore {
    var items: [String: String] = [:]
    func read(account: String) throws -> String? { items[account] }
    func write(_ value: String, account: String) throws { items[account] = value }
    func delete(account: String) throws { items[account] = nil }
}
