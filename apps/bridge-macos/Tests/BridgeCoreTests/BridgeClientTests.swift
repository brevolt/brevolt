import XCTest
@testable import BridgeCore

final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?
    nonisolated(unsafe) static var last: URLRequest?
    nonisolated(unsafe) static var lastBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.last = request
        if let s = request.httpBodyStream {
            s.open(); var d = Data(); var buf = [UInt8](repeating: 0, count: 1024)
            while s.hasBytesAvailable { let n = s.read(&buf, maxLength: 1024); if n <= 0 { break }; d.append(buf, count: n) }
            Self.lastBody = d
        } else { Self.lastBody = request.httpBody }
        let (status, data) = Self.handler?(request) ?? (500, Data())
        let resp = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class BridgeClientTests: XCTestCase {
    private func session() -> URLSession {
        let c = URLSessionConfiguration.ephemeral
        c.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: c)
    }

    private func client(_ url: String = "https://hub.example", token: String? = "tok") throws -> BridgeClient {
        try BridgeClient(serverURL: url, tokenProvider: { token }, session: session())
    }

    private func fixture(_ name: String) throws -> Data {
        let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")!
        return try Data(contentsOf: url)
    }

    func testPendingDecodesContractFixtureAndSendsBearer() async throws {
        let data = try fixture("pending")
        StubProtocol.handler = { _ in (200, data) }
        let r = try await client().pending(cursor: "c-1")
        XCTAssertEqual(r.nextCursor, "1")
        XCTAssertEqual(r.changes.first?.operationId, "pend:0190a000-0000-7000-8000-000000000001:abc")
        XCTAssertNil(r.changes.first?.localId); XCTAssertEqual(r.changes.first?.contact?.givenName, "Grace")
        XCTAssertEqual(StubProtocol.last?.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(StubProtocol.last?.url?.path, "/v1/bridge/pending")
        XCTAssertEqual(StubProtocol.last?.url?.query, "cursor=c-1")
    }

    func testUploadAndAckShapes() async throws {
        StubProtocol.handler = { _ in (200, Data("{\"results\":[]}".utf8)) }
        let c = try client()
        try await c.upload(changes: [IncomingChange(operationId: "o", localId: "l", containerId: "c", kind: .delete)])
        XCTAssertEqual(StubProtocol.last?.httpMethod, "POST")
        XCTAssertEqual(StubProtocol.last?.url?.path, "/v1/bridge/changes")
        let obj = try JSONSerialization.jsonObject(with: StubProtocol.lastBody!) as! [String: Any]
        let first = (obj["changes"] as! [[String: Any]])[0]
        XCTAssertEqual(first["operation_id"] as? String, "o")
        XCTAssertEqual(first["kind"] as? String, "delete")

        try await c.ack([Ack(operationId: "o", status: .ok, localId: "new")])
        XCTAssertEqual(StubProtocol.last?.url?.path, "/v1/bridge/ack")
        let ack = try JSONSerialization.jsonObject(with: StubProtocol.lastBody!) as! [String: Any]
        XCTAssertEqual((ack["acks"] as! [[String: Any]])[0]["local_id"] as? String, "new")
    }

    func testRejectsInsecureAndInvalidURLs() {
        XCTAssertThrowsError(try BridgeClient(serverURL: "http://hub.example", tokenProvider: { "t" })) {
            XCTAssertEqual($0 as? BridgeClientError, .insecureServerURL)
        }
        XCTAssertThrowsError(try BridgeClient(serverURL: "not a url", tokenProvider: { "t" })) {
            XCTAssertEqual($0 as? BridgeClientError, .invalidServerURL)
        }
    }

    func testMissingTokenAndHTTPErrors() async throws {
        do { _ = try await client(token: nil).pending(cursor: nil); XCTFail() }
        catch { XCTAssertEqual(error as? BridgeClientError, .missingToken) }
        StubProtocol.handler = { _ in (401, Data()) }
        do { _ = try await client().pending(cursor: nil); XCTFail() }
        catch { XCTAssertEqual(error as? BridgeClientError, .http(status: 401)) }
    }
}
