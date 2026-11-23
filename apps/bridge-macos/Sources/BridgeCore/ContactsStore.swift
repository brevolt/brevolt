import Contacts
import CHShim
import Foundation

public enum ContactsHistoryEvent {
    /// Added or updated contact, with the container it lives in.
    case upsert(CNContact, containerID: String)
    /// Delete events only carry the identifier.
    case delete(identifier: String)
    /// Token expired or invalid: the read is a full snapshot (ADR-0008, R-BR-5).
    case dropEverything
}

public struct ContactsHistoryBatch {
    public var events: [ContactsHistoryEvent]
    public var token: Data?
    public init(events: [ContactsHistoryEvent], token: Data?) { self.events = events; self.token = token }
}

public enum ContactsStoreError: Error, Equatable { case historyExpired }

/// The slice of the Contacts store the bridge uses; tests inject a fake.
public protocol ContactsStoring {
    /// Current history token (taken before a snapshot, so changes made during it are not lost).
    func currentHistoryToken() throws -> Data?
    /// Changes since `token`, excluding the bridge's own writes. May throw `.historyExpired`.
    func history(since token: Data?) throws -> ContactsHistoryBatch
    /// Every contact of one container.
    func allContacts(containerID: String) throws -> [CNContact]
}

public enum BridgeIdentity {
    /// Tags every bridge write; excluded when reading history (R-BR-3).
    public static let transactionAuthor = "com.brevolt.bridge"
}

public final class SystemContactsStore: ContactsStoring {
    private let store: CNContactStore
    public init(store: CNContactStore = CNContactStore()) { self.store = store }

    public func currentHistoryToken() throws -> Data? {
        let req = CNChangeHistoryFetchRequest()
        req.startingToken = nil
        req.excludedTransactionAuthors = [BridgeIdentity.transactionAuthor]
        var token: NSData?
        _ = try CHShim.fetchHistory(store, request: req, outToken: &token)
        return token as Data?
    }

    public func history(since token: Data?) throws -> ContactsHistoryBatch {
        let req = CNChangeHistoryFetchRequest()
        req.startingToken = token
        req.excludedTransactionAuthors = [BridgeIdentity.transactionAuthor]
        req.shouldUnifyResults = false
        req.additionalContactKeyDescriptors = ContactMapping.keysToFetch
        var newToken: NSData?
        let raw: [CNChangeHistoryEvent]
        do { raw = try CHShim.fetchHistory(store, request: req, outToken: &newToken) }
        catch let e as CNError where e.code == .changeHistoryExpired { throw ContactsStoreError.historyExpired }
        var events: [ContactsHistoryEvent] = []
        for e in raw {
            switch e {
            case let a as CNChangeHistoryAddContactEvent: events.append(try upsert(a.contact))
            case let u as CNChangeHistoryUpdateContactEvent: events.append(try upsert(u.contact))
            case let d as CNChangeHistoryDeleteContactEvent: events.append(.delete(identifier: d.contactIdentifier))
            case is CNChangeHistoryDropEverythingEvent: events.append(.dropEverything)
            default: break
            }
        }
        return ContactsHistoryBatch(events: events, token: newToken as Data?)
    }

    private func upsert(_ c: CNContact) throws -> ContactsHistoryEvent {
        let containers = try store.containers(matching: CNContainer.predicateForContainerOfContact(withIdentifier: c.identifier))
        return .upsert(c, containerID: containers.first?.identifier ?? "")
    }

    public func allContacts(containerID: String) throws -> [CNContact] {
        let req = CNContactFetchRequest(keysToFetch: ContactMapping.keysToFetch)
        req.unifyResults = false
        req.predicate = CNContact.predicateForContactsInContainer(withIdentifier: containerID)
        var out: [CNContact] = []
        try store.enumerateContacts(with: req) { c, _ in out.append(c) }
        return out
    }
}
