import Contacts
import XCTest
@testable import BridgeCore

final class FakeContactsStore: ContactsStoring {
    var token: Data? = Data("t0".utf8)
    var batch = ContactsHistoryBatch(events: [], token: Data("t1".utf8))
    var historyError: Error?
    var contacts: [CNContact] = []
    var historyCalls = 0
    func currentHistoryToken() throws -> Data? { token }
    func history(since: Data?) throws -> ContactsHistoryBatch {
        historyCalls += 1
        if let historyError { throw historyError }
        return batch
    }
    func allContacts(containerID: String) throws -> [CNContact] { contacts }
}

final class FakeUploader: ChangesUploading {
    var calls: [(changes: [IncomingChange], snapshot: Bool)] = []
    var failures: [Error] = []
    func upload(changes: [IncomingChange], snapshot: Bool) async throws -> ChangesResponse {
        if !failures.isEmpty { throw failures.removeFirst() }
        calls.append((changes, snapshot))
        return ChangesResponse(results: [])
    }
}

final class MemoryCheckpoints: CheckpointStore { var historyToken: Data? }


final class ContactsUploaderTests: XCTestCase {
    private var n = 0
    private func makeUploader(_ store: FakeContactsStore, _ client: FakeUploader, _ cp: MemoryCheckpoints,
                              batchSize: Int = 200) -> ContactsUploader {
        n = 0
        return ContactsUploader(store: store, client: client, checkpoints: cp, containerID: "box", batchSize: batchSize,
                                makeOperationID: { [unowned self] in n += 1; return "op-\(n)" })
    }

    // MARK: mapping

    func testMapsCNContactToContract() {
        let c = CNMutableContact()
        c.namePrefix = "Dr"; c.givenName = " Ada "; c.familyName = "Lovelace"; c.organizationName = "Engines"
        c.jobTitle = ""; c.note = "must never leak"
        c.birthday = DateComponents(year: 1815, month: 12, day: 10)
        c.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: "+34 600 111 222"))]
        c.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: "ada@example.com" as NSString),
                            CNLabeledValue(label: nil, value: "  " as NSString)]
        c.urlAddresses = [CNLabeledValue(label: CNLabelHome, value: "https://ada.example" as NSString)]
        let m = ContactMapping.map(c)
        XCTAssertEqual(m.prefix, "Dr"); XCTAssertEqual(m.givenName, "Ada"); XCTAssertEqual(m.familyNames, "Lovelace")
        XCTAssertEqual(m.company, "Engines"); XCTAssertNil(m.jobTitle); XCTAssertNil(m.middleName)
        XCTAssertEqual(m.birthday, "1815-12-10")
        XCTAssertEqual(m.fields, [
            BridgeField(kind: .phone, label: "mobile", value: "+34 600 111 222"),
            BridgeField(kind: .email, label: "work", value: "ada@example.com"),
            BridgeField(kind: .url, label: "home", value: "https://ada.example"),
        ])
        let json = String(data: try! JSONEncoder().encode(m), encoding: .utf8)!
        XCTAssertFalse(json.contains("must never leak"))
    }

    func testBirthdayWithoutYearAndAddress() {
        let c = CNMutableContact()
        c.birthday = DateComponents(year: 1604, month: 3, day: 12)
        let a = CNMutablePostalAddress(); a.street = "1 Main St"; a.city = "Madrid"
        c.postalAddresses = [CNLabeledValue(label: "Cabin", value: a)]
        let m = ContactMapping.map(c)
        XCTAssertEqual(m.birthday, "--03-12")
        XCTAssertEqual(m.fields.count, 1)
        XCTAssertEqual(m.fields[0].kind, .address)
        XCTAssertFalse(m.fields[0].value.contains("\n"))
        XCTAssertTrue(m.fields[0].value.contains("Madrid"))
        XCTAssertEqual(ContactMapping.mapLabel(nil), "other")
    }

    func testMappedChangeMatchesContractFixtureShape() throws {
        let c = CNMutableContact(); c.givenName = "Ada"
        let change = IncomingChange(operationId: "o", localId: "l", containerId: "c", kind: .upsert, contact: ContactMapping.map(c))
        let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(change)) as! [String: Any]
        let contactObj = obj["contact"] as! [String: Any]
        XCTAssertEqual(Set(contactObj.keys), ["prefix", "givenName", "middleName", "familyNames", "suffix",
                                              "nickname", "company", "jobTitle", "birthday", "fields"])
    }

    // MARK: sync

    func testIncrementalUploadsOnlyConfiguredContainerAndAdvancesToken() async throws {
        let store = FakeContactsStore(), client = FakeUploader(), cp = MemoryCheckpoints()
        cp.historyToken = Data("t0".utf8)
        let mine = CNMutableContact(); mine.givenName = "Mine"
        let other = CNMutableContact(); other.givenName = "Other"
        store.batch = ContactsHistoryBatch(events: [
            .upsert(mine, containerID: "box"), .upsert(other, containerID: "elsewhere"), .delete(identifier: "gone"),
        ], token: Data("t1".utf8))
        let s = try await makeUploader(store, client, cp).sync()
        XCTAssertEqual(s, UploadSummary(uploaded: 2, snapshot: false))
        XCTAssertEqual(client.calls.count, 1)
        XCTAssertFalse(client.calls[0].snapshot)
        XCTAssertEqual(client.calls[0].changes.map(\.kind), [.upsert, .delete])
        XCTAssertEqual(client.calls[0].changes.map(\.containerId), ["box", "box"])
        XCTAssertEqual(client.calls[0].changes[1].localId, "gone")
        XCTAssertEqual(cp.historyToken, Data("t1".utf8))
    }

    func testLastEventPerContactWins() async throws {
        let store = FakeContactsStore(), client = FakeUploader(), cp = MemoryCheckpoints()
        cp.historyToken = Data("t0".utf8)
        let c = CNMutableContact(); c.givenName = "A"
        store.batch = ContactsHistoryBatch(events: [
            .upsert(c, containerID: "box"), .upsert(c, containerID: "box"), .delete(identifier: c.identifier),
        ], token: nil)
        try await makeUploader(store, client, cp).sync()
        XCTAssertEqual(client.calls[0].changes.map(\.kind), [.delete])
        XCTAssertEqual(cp.historyToken, Data("t0".utf8)) // no new token: keep the old one
    }

    func testNetworkFailureKeepsTokenAndRetryRecovers() async throws {
        let store = FakeContactsStore(), client = FakeUploader(), cp = MemoryCheckpoints()
        cp.historyToken = Data("t0".utf8)
        let c = CNMutableContact(); c.givenName = "A"
        store.batch = ContactsHistoryBatch(events: [.upsert(c, containerID: "box")], token: Data("t1".utf8))
        client.failures = [URLError(.notConnectedToInternet), BridgeClientError.http(status: 503)]
        let up = makeUploader(store, client, cp)

        do { try await up.sync(); XCTFail() } catch {}
        XCTAssertEqual(cp.historyToken, Data("t0".utf8))

        client.failures = [URLError(.timedOut), BridgeClientError.http(status: 503)]
        var delays: [TimeInterval] = []
        let policy = RetryPolicy(maxAttempts: 5, baseDelay: 2, maxDelay: 60, sleep: { delays.append($0) })
        let summary = try await policy.run { try await up.sync() }
        XCTAssertEqual(summary.uploaded, 1)
        XCTAssertEqual(delays, [2, 4])
        XCTAssertEqual(cp.historyToken, Data("t1".utf8))
    }

    func testRetryDoesNotRepeatPermanentErrors() async {
        var calls = 0
        let policy = RetryPolicy(sleep: { _ in })
        do { try await policy.run { calls += 1; throw BridgeClientError.http(status: 401) }; XCTFail() } catch {}
        XCTAssertEqual(calls, 1)
        XCTAssertTrue(RetryPolicy.isTransient(BridgeClientError.http(status: 429)))
        XCTAssertFalse(RetryPolicy.isTransient(BridgeClientError.missingToken))
    }

    func testNoTokenDoesFullSnapshotInBatches() async throws {
        let store = FakeContactsStore(), client = FakeUploader(), cp = MemoryCheckpoints()
        store.contacts = (0..<5).map { i in let c = CNMutableContact(); c.givenName = "C\(i)"; return c }
        let s = try await makeUploader(store, client, cp, batchSize: 2).sync()
        XCTAssertEqual(s, UploadSummary(uploaded: 5, snapshot: true))
        XCTAssertEqual(client.calls.map(\.changes.count), [2, 2, 1])
        XCTAssertTrue(client.calls.allSatisfy(\.snapshot))
        XCTAssertEqual(store.historyCalls, 0)
        XCTAssertEqual(cp.historyToken, Data("t0".utf8))
    }

    func testExpiredTokenAndDropEverythingFallBackToSnapshot() async throws {
        for mode in ["expired", "drop"] {
            let store = FakeContactsStore(), client = FakeUploader(), cp = MemoryCheckpoints()
            cp.historyToken = Data("old".utf8)
            store.token = Data("fresh".utf8)
            let c = CNMutableContact(); c.givenName = "A"
            store.contacts = [c]
            if mode == "expired" { store.historyError = ContactsStoreError.historyExpired }
            else { store.batch = ContactsHistoryBatch(events: [.dropEverything, .upsert(c, containerID: "box")], token: Data("x".utf8)) }
            let s = try await makeUploader(store, client, cp).sync()
            XCTAssertTrue(s.snapshot, mode)
            XCTAssertTrue(client.calls[0].snapshot, mode)
            XCTAssertEqual(cp.historyToken, Data("fresh".utf8), mode)
        }
    }

    func testSchedulerCoalescesRequests() async {
        let counter = Counter()
        let scheduler = SyncScheduler { await counter.run() }
        await counter.setScheduler(scheduler)
        await scheduler.request()
        let runs = await counter.runs
        XCTAssertEqual(runs, 2) // one request arrived mid-run → exactly one rerun
    }

    func testMonitorDebouncesNotifications() async throws {
        let center = NotificationCenter()
        let name = Notification.Name("test.change")
        let box = Box()
        let monitor = ContactsChangeMonitor(debounce: 0.05, center: center, name: name) { box.bump() }
        for _ in 0..<5 { center.post(name: name, object: nil) }
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(box.value, 1)
        withExtendedLifetime(monitor) {}
    }
}

actor Counter {
    var runs = 0
    var scheduler: SyncScheduler?
    func setScheduler(_ s: SyncScheduler) { scheduler = s }
    func run() async {
        runs += 1
        if runs == 1 { await scheduler?.request() }
    }
}

final class Box: @unchecked Sendable {
    private let lock = NSLock(); private var v = 0
    func bump() { lock.lock(); v += 1; lock.unlock() }
    var value: Int { lock.lock(); defer { lock.unlock() }; return v }
}
