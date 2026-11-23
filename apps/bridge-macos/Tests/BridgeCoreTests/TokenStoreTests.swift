import XCTest
@testable import BridgeCore

final class TokenStoreTests: XCTestCase {
    func testTokenGoesToSecretStoreOnly() throws {
        let kc = FakeKeychain()
        let suite = "bridge-test-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        try TokenStore(store: kc).save("  synthetic-token  ")
        SettingsStore(defaults: defaults).save(BridgeSettings(serverURL: "https://hub.example", containerID: "c", syncEnabled: true))

        XCTAssertEqual(try TokenStore(store: kc).token(), "synthetic-token")
        let dump = defaults.persistentDomain(forName: suite) ?? [:]
        XCTAssertFalse(String(describing: dump).contains("synthetic-token"))
        XCTAssertEqual(Set(dump.keys), ["serverURL", "containerID", "syncEnabled", "paused"])
    }

    func testEmptyTokenClears() throws {
        let kc = FakeKeychain()
        let store = TokenStore(store: kc)
        try store.save("x")
        try store.save("   ")
        XCTAssertNil(try store.token())
    }

    func testStatusResolution() {
        XCTAssertEqual(SyncState.resolve(settings: BridgeSettings(), hasToken: false), .notConfigured)
        let on = BridgeSettings(serverURL: "https://h.example", syncEnabled: true)
        XCTAssertEqual(SyncState.resolve(settings: on, hasToken: true), .pending)
        var paused = on; paused.paused = true
        XCTAssertEqual(SyncState.resolve(settings: paused, hasToken: true), .paused)
    }

    func testContactsAccessRequestedOnlyWhenEnabling() async {
        final class Spy: ContactsAccess { var calls = 0; var grant = true
            func requestAccess() async -> Bool { calls += 1; return grant } }
        let spy = Spy()
        let toggle = SyncToggle(access: spy)
        let off = await toggle.setEnabled(false)
        XCTAssertFalse(off); XCTAssertEqual(spy.calls, 0)
        let on = await toggle.setEnabled(true)
        XCTAssertTrue(on); XCTAssertEqual(spy.calls, 1)
        spy.grant = false
        let denied = await toggle.setEnabled(true)
        XCTAssertFalse(denied)
    }
}
