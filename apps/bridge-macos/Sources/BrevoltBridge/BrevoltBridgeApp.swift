import SwiftUI
import Contacts
import ServiceManagement
import BridgeCore

struct SystemContactsAccess: ContactsAccess {
    func requestAccess() async -> Bool {
        (try? await CNContactStore().requestAccess(for: .contacts)) ?? false
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var settings: BridgeSettings
    @Published var state = SyncState()
    @Published var tokenDraft = ""
    @Published var message: String?

    private let settingsStore = SettingsStore()
    private let tokens = TokenStore(store: KeychainStore())
    private let toggle = SyncToggle(access: SystemContactsAccess())
    private let checkpoints = DefaultsCheckpointStore()
    private var monitor: ContactsChangeMonitor?
    private var scheduler: SyncScheduler?
    private var timer: Timer?

    init() {
        settings = settingsStore.load()
        refreshStatus()
        configureSync()
    }

    /// Contacts are touched only while sync is enabled and not paused.
    private func configureSync() {
        monitor = nil; scheduler = nil; timer?.invalidate(); timer = nil
        guard settings.syncEnabled, !settings.paused, !settings.containerID.isEmpty else { return }
        let scheduler = SyncScheduler { [weak self] in await self?.performSync() }
        self.scheduler = scheduler
        monitor = ContactsChangeMonitor { Task { await scheduler.request() } }
        // Safety net for notifications iCloud coalesces or drops.
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { _ in Task { await scheduler.request() } }
        Task { await scheduler.request() }
    }

    private func performSync() async {
        let s = settings
        do {
            let client = try BridgeClient(serverURL: s.serverURL, tokenProvider: { [tokens] in try tokens.token() },
                                          session: BridgeClient.makeSession())
            let uploader = ContactsUploader(store: SystemContactsStore(), client: client,
                                            checkpoints: checkpoints, containerID: s.containerID)
            try await RetryPolicy().run { try await uploader.sync() }
            state.lastSync = Date()
            state.pendingCount = 0
            state.status = .synced
        } catch {
            state.status = .error(Self.describe(error))
        }
    }

    private static func describe(_ e: Error) -> String {
        switch e {
        case BridgeClientError.http(let s): return "server returned \(s)"
        case BridgeClientError.missingToken: return "missing token"
        case BridgeClientError.insecureServerURL: return "server URL must be https"
        case BridgeClientError.invalidServerURL: return "invalid server URL"
        case is URLError: return "network unavailable"
        default: return "sync failed"
        }
    }

    var hasToken: Bool { ((try? tokens.token()) ?? nil) != nil }

    func refreshStatus() {
        state.status = SyncState.resolve(settings: settings, hasToken: hasToken)
    }

    func saveSettings() {
        settingsStore.save(settings)
        do {
            if !tokenDraft.isEmpty { try tokens.save(tokenDraft); tokenDraft = "" }
        } catch { message = "Could not store the token in the Keychain." }
        refreshStatus()
        configureSync()
    }

    func setSync(_ on: Bool) {
        Task {
            settings.syncEnabled = await toggle.setEnabled(on)
            if on && !settings.syncEnabled { message = "Contacts access was not granted." }
            settingsStore.save(settings)
            refreshStatus()
            configureSync()
        }
    }

    func syncNow() {
        guard settings.syncEnabled, !settings.paused, let scheduler else { return }
        Task { await scheduler.request() }
    }

    func togglePause() {
        settings.paused.toggle()
        settingsStore.save(settings)
        refreshStatus()
        configureSync()
    }

    var launchAtLogin: Bool {
        get { SMAppService.mainApp.status == .enabled }
        set {
            do { if newValue { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
            catch { message = "Could not change launch at login." }
            objectWillChange.send()
        }
    }

    var statusText: String {
        switch state.status {
        case .notConfigured: return "Not configured"
        case .synced: return "Synced"
        case .pending: return "Pending"
        case .paused: return "Paused"
        case .error(let m): return "Error: \(m)"
        }
    }

    var iconName: String {
        switch state.status {
        case .synced: return "person.crop.circle.badge.checkmark"
        case .error: return "person.crop.circle.badge.exclamationmark"
        case .paused: return "pause.circle"
        default: return "person.crop.circle"
        }
    }
}

@main
struct BrevoltBridgeApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra("Brevolt", systemImage: model.iconName) {
            MenuView(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}

struct MenuView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Status: \(model.statusText)").font(.headline)
            Text("Last sync: \(model.state.lastSync.map { $0.formatted() } ?? "never")")
            Text("Pending changes: \(model.state.pendingCount)")
            HStack {
                Button("Sync now") { model.syncNow() }
                    .disabled(!model.settings.syncEnabled || model.settings.paused)
                Button(model.settings.paused ? "Resume" : "Pause") { model.togglePause() }
            }
            Divider()
            Form {
                TextField("Server URL", text: $model.settings.serverURL)
                SecureField(model.hasToken ? "Token (stored in Keychain)" : "Token", text: $model.tokenDraft)
                TextField("iCloud container", text: $model.settings.containerID)
                Toggle("Enable sync", isOn: Binding(get: { model.settings.syncEnabled }, set: { model.setSync($0) }))
                Toggle("Launch at login", isOn: Binding(get: { model.launchAtLogin }, set: { model.launchAtLogin = $0 }))
                Button("Save") { model.saveSettings() }
            }
            if let m = model.message { Text(m).foregroundStyle(.red).font(.caption) }
            Divider()
            Button("Quit") { NSApplication.shared.terminate(nil) }
        }
        .padding(12)
        .frame(width: 320)
    }
}
