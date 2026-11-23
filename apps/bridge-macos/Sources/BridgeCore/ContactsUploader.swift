import Foundation

public protocol ChangesUploading {
    @discardableResult
    func upload(changes: [IncomingChange], snapshot: Bool) async throws -> ChangesResponse
}
extension BridgeClient: ChangesUploading {}

public struct UploadSummary: Equatable {
    public var uploaded: Int
    public var snapshot: Bool
}

/// Contacts → server (R-BR-1, R-BR-5, R-BR-6). The history token is persisted only after the
/// whole batch was accepted, so any failure leaves it untouched and the next run retries.
public final class ContactsUploader {
    private let store: ContactsStoring
    private let client: ChangesUploading
    private let checkpoints: CheckpointStore
    private let containerID: String
    private let batchSize: Int
    private let makeOperationID: () -> String

    public init(store: ContactsStoring, client: ChangesUploading, checkpoints: CheckpointStore,
                containerID: String, batchSize: Int = 200,
                makeOperationID: @escaping () -> String = { "mac-" + UUID().uuidString.lowercased() }) {
        self.store = store; self.client = client; self.checkpoints = checkpoints
        self.containerID = containerID; self.batchSize = max(1, min(batchSize, 500))
        self.makeOperationID = makeOperationID
    }

    @discardableResult
    public func sync() async throws -> UploadSummary {
        guard let token = checkpoints.historyToken else { return try await snapshot() }
        let batch: ContactsHistoryBatch
        do { batch = try store.history(since: token) }
        catch ContactsStoreError.historyExpired { return try await snapshot() }
        if batch.events.contains(where: { if case .dropEverything = $0 { return true } else { return false } }) {
            return try await snapshot()
        }
        let changes = collapse(batch.events)
        try await upload(changes, snapshot: false)
        checkpoints.historyToken = batch.token ?? token
        return UploadSummary(uploaded: changes.count, snapshot: false)
    }

    private func snapshot() async throws -> UploadSummary {
        // Token first: edits made while we read are then replayed by the next incremental read.
        let token = try store.currentHistoryToken()
        let changes = try store.allContacts(containerID: containerID).map {
            IncomingChange(operationId: makeOperationID(), localId: $0.identifier, containerId: containerID,
                           kind: .upsert, contact: ContactMapping.map($0))
        }
        try await upload(changes, snapshot: true)
        checkpoints.historyToken = token
        return UploadSummary(uploaded: changes.count, snapshot: true)
    }

    /// Last event per contact wins; contacts of other containers are ignored (R-BR-6).
    private func collapse(_ events: [ContactsHistoryEvent]) -> [IncomingChange] {
        var order: [String] = []
        var latest: [String: IncomingChange] = [:]
        func put(_ id: String, _ change: IncomingChange?) {
            if latest[id] == nil, change != nil { order.append(id) }
            if let change { latest[id] = change } else if latest[id] != nil { latest[id] = nil; order.removeAll { $0 == id } }
        }
        for e in events {
            switch e {
            case .upsert(let c, let container):
                guard container == containerID else { put(c.identifier, nil); continue }
                put(c.identifier, IncomingChange(operationId: makeOperationID(), localId: c.identifier,
                                                 containerId: containerID, kind: .upsert, contact: ContactMapping.map(c)))
            case .delete(let id):
                put(id, IncomingChange(operationId: makeOperationID(), localId: id, containerId: containerID, kind: .delete))
            case .dropEverything: break
            }
        }
        return order.compactMap { latest[$0] }
    }

    private func upload(_ changes: [IncomingChange], snapshot: Bool) async throws {
        var i = 0
        while i < changes.count {
            let end = min(i + batchSize, changes.count)
            try await client.upload(changes: Array(changes[i..<end]), snapshot: snapshot)
            i = end
        }
    }
}
