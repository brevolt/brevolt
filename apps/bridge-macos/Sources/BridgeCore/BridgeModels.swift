import Foundation

// Bridge contract (docs/spec.md, "Bridge contract (summary)").
// Contact fields stay opaque here: the skeleton only transports them (BRV-035/036 map them).

public enum ChangeKind: String, Codable, Equatable { case upsert, delete }

public enum ContactFieldKind: String, Codable, Equatable { case phone, email, address, url }

public struct BridgeField: Codable, Equatable {
    public var kind: ContactFieldKind
    public var label: String
    public var value: String

    public init(kind: ContactFieldKind, label: String, value: String) {
        self.kind = kind; self.label = label; self.value = value
    }
}

/// A contact as the Contacts app holds it (`bridgeContactSchema`). Nil text fields are
/// encoded as `null`, which the server schema accepts.
public struct BridgeContact: Codable, Equatable {
    public var prefix: String?
    public var givenName: String?
    public var middleName: String?
    public var familyNames: String?
    public var suffix: String?
    public var nickname: String?
    public var company: String?
    public var jobTitle: String?
    public var birthday: String?
    public var fields: [BridgeField]

    public init(prefix: String? = nil, givenName: String? = nil, middleName: String? = nil,
                familyNames: String? = nil, suffix: String? = nil, nickname: String? = nil,
                company: String? = nil, jobTitle: String? = nil, birthday: String? = nil,
                fields: [BridgeField] = []) {
        self.prefix = prefix; self.givenName = givenName; self.middleName = middleName
        self.familyNames = familyNames; self.suffix = suffix; self.nickname = nickname
        self.company = company; self.jobTitle = jobTitle; self.birthday = birthday; self.fields = fields
    }

    // Explicit encode so nil becomes `null` (the server fills defaults either way).
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(prefix, forKey: .prefix); try c.encode(givenName, forKey: .givenName)
        try c.encode(middleName, forKey: .middleName); try c.encode(familyNames, forKey: .familyNames)
        try c.encode(suffix, forKey: .suffix); try c.encode(nickname, forKey: .nickname)
        try c.encode(company, forKey: .company); try c.encode(jobTitle, forKey: .jobTitle)
        try c.encode(birthday, forKey: .birthday); try c.encode(fields, forKey: .fields)
    }

    enum CodingKeys: String, CodingKey {
        case prefix, givenName, middleName, familyNames, suffix, nickname, company, jobTitle, birthday, fields
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        prefix = try c.decodeIfPresent(String.self, forKey: .prefix)
        givenName = try c.decodeIfPresent(String.self, forKey: .givenName)
        middleName = try c.decodeIfPresent(String.self, forKey: .middleName)
        familyNames = try c.decodeIfPresent(String.self, forKey: .familyNames)
        suffix = try c.decodeIfPresent(String.self, forKey: .suffix)
        nickname = try c.decodeIfPresent(String.self, forKey: .nickname)
        company = try c.decodeIfPresent(String.self, forKey: .company)
        jobTitle = try c.decodeIfPresent(String.self, forKey: .jobTitle)
        birthday = try c.decodeIfPresent(String.self, forKey: .birthday)
        fields = try c.decodeIfPresent([BridgeField].self, forKey: .fields) ?? []
    }
}

/// `POST /v1/bridge/changes` item.
public struct IncomingChange: Codable, Equatable {
    public var operationId: String
    public var localId: String
    public var containerId: String
    public var kind: ChangeKind
    public var contact: BridgeContact?

    enum CodingKeys: String, CodingKey {
        case operationId = "operation_id", localId = "local_id", containerId = "container_id", kind, contact
    }

    public init(operationId: String, localId: String, containerId: String, kind: ChangeKind, contact: BridgeContact? = nil) {
        self.operationId = operationId; self.localId = localId; self.containerId = containerId
        self.kind = kind; self.contact = contact
    }
}

public struct ChangeResult: Codable, Equatable {
    public var operationId: String
    public var outcome: String
    public var contactId: String?
    enum CodingKeys: String, CodingKey { case operationId = "operation_id", outcome, contactId = "contact_id" }
}

public struct ChangesResponse: Codable, Equatable {
    public var results: [ChangeResult]
}

public struct PendingChange: Codable, Equatable {
    public var operationId: String
    public var contactId: String
    public var localId: String?
    public var kind: ChangeKind
    public var contact: BridgeContact?

    enum CodingKeys: String, CodingKey {
        case operationId = "operation_id", contactId = "contact_id", localId = "local_id", kind, contact
    }
}

public struct PendingResponse: Codable, Equatable {
    public var changes: [PendingChange]
    public var nextCursor: String?
    enum CodingKeys: String, CodingKey { case changes, nextCursor = "next_cursor" }
}

public enum AckStatus: String, Codable, Equatable { case ok, error }

public struct Ack: Codable, Equatable {
    public var operationId: String
    public var status: AckStatus
    public var localId: String?
    public var error: String?

    enum CodingKeys: String, CodingKey { case operationId = "operation_id", status, localId = "local_id", error }

    public init(operationId: String, status: AckStatus, localId: String? = nil, error: String? = nil) {
        self.operationId = operationId; self.status = status; self.localId = localId; self.error = error
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
