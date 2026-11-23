import Foundation

public enum BridgeClientError: Error, Equatable {
    case invalidServerURL
    case insecureServerURL
    case missingToken
    case http(status: Int)
    case invalidResponse
}

/// HTTP client for `/v1/bridge/*`. Uses the system trust evaluation: the server
/// certificate is always validated, and plain `http` is refused (no ATS-style
/// exceptions, no custom trust overrides).
public final class BridgeClient {
    private let baseURL: URL
    private let tokenProvider: () throws -> String?
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(serverURL: String, tokenProvider: @escaping () throws -> String?, session: URLSession = .shared) throws {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespaces)), url.host != nil else {
            throw BridgeClientError.invalidServerURL
        }
        guard url.scheme?.lowercased() == "https" else { throw BridgeClientError.insecureServerURL }
        self.baseURL = url
        self.tokenProvider = tokenProvider
        self.session = session
    }

    /// Session whose delegate never overrides certificate validation.
    public static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.tlsMinimumSupportedProtocolVersion = .TLSv12
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        return URLSession(configuration: config)
    }

    /// `snapshot` marks a full read after the history token expired (R-BR-5).
    @discardableResult
    public func upload(changes: [IncomingChange], snapshot: Bool = false) async throws -> ChangesResponse {
        struct Body: Encodable { let snapshot: Bool; let changes: [IncomingChange] }
        let data = try await send("POST", "/v1/bridge/changes", body: try encoder.encode(Body(snapshot: snapshot, changes: changes)))
        do { return try decoder.decode(ChangesResponse.self, from: data) } catch { throw BridgeClientError.invalidResponse }
    }

    public func pending(cursor: String?) async throws -> PendingResponse {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        let data = try await send("GET", "/v1/bridge/pending", query: query)
        do { return try decoder.decode(PendingResponse.self, from: data) } catch { throw BridgeClientError.invalidResponse }
    }

    public func ack(_ acks: [Ack]) async throws {
        struct Body: Encodable { let acks: [Ack] }
        _ = try await send("POST", "/v1/bridge/ack", body: try encoder.encode(Body(acks: acks)))
    }

    private func send(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil) async throws -> Data {
        guard let token = try tokenProvider(), !token.isEmpty else { throw BridgeClientError.missingToken }
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        comps?.queryItems = query.isEmpty ? nil : query
        guard let url = comps?.url else { throw BridgeClientError.invalidServerURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw BridgeClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw BridgeClientError.http(status: http.statusCode) }
        return data
    }
}
