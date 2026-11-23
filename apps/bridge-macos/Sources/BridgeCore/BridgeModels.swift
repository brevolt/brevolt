import Foundation

// Bridge contract (docs/spec.md, "Bridge contract (summary)").
// Contact fields stay opaque here: the skeleton only transports them (BRV-035/036 map them).

public enum ChangeKind: String, Codable, Equatable { case upsert, delete }

public struct IncomingChange: Codable, Equatable {
    public var operationId: String
    public var localId: String
    public var containerId: String
    public var kind: ChangeKind
    public var fields: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case operationId = "operation_id", localId = "local_id", containerId = "container_id", kind, fields
    }

    public init(operationId: String, localId: String, containerId: String, kind: ChangeKind, fields: [String: JSONValue]? = nil) {
        self.operationId = operationId; self.localId = localId; self.containerId = containerId
        self.kind = kind; self.fields = fields
    }
}

public struct PendingChange: Codable, Equatable {
    public var operationId: String
    public var contactId: String
    public var localId: String?
    public var contact: [String: JSONValue]

    enum CodingKeys: String, CodingKey {
        case operationId = "operation_id", contactId = "contact_id", localId = "local_id", contact
    }
}

public struct PendingResponse: Codable, Equatable {
    public var changes: [PendingChange]
    public var cursor: String
}

public enum AckStatus: String, Codable, Equatable { case ok, error }

public struct Ack: Codable, Equatable {
    public var operationId: String
    public var status: AckStatus
    public var localId: String?

    enum CodingKeys: String, CodingKey { case operationId = "operation_id", status, localId = "local_id" }

    public init(operationId: String, status: AckStatus, localId: String? = nil) {
        self.operationId = operationId; self.status = status; self.localId = localId
    }
}

/// Arbitrary JSON value.
public enum JSONValue: Codable, Equatable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}
