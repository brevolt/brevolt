import Foundation
import Security

/// Minimal secret storage. The real implementation is the macOS Keychain;
/// tests use an in-memory fake (R-SEC-11).
public protocol SecretStore: AnyObject {
    func read(account: String) throws -> String?
    func write(_ value: String, account: String) throws
    func delete(account: String) throws
}

public enum KeychainError: Error, Equatable {
    case unexpectedStatus(OSStatus)
    case invalidData
}

public final class KeychainStore: SecretStore {
    private let service: String

    public init(service: String = "com.brevolt.bridge") {
        self.service = service
    }

    private func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func read(account: String) throws -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        guard let data = item as? Data, let s = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return s
    }

    public func write(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        let status = SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
        var add = query(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
    }

    public func delete(account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}

/// Holds the API token. It lives only in the secret store: never in
/// UserDefaults, files or logs.
public struct TokenStore {
    static let account = "api-token"
    private let store: SecretStore

    public init(store: SecretStore) { self.store = store }

    public func token() throws -> String? { try store.read(account: Self.account) }

    public func save(_ token: String) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { try store.delete(account: Self.account) } else { try store.write(trimmed, account: Self.account) }
    }

    public func clear() throws { try store.delete(account: Self.account) }
}
