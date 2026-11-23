import Foundation

/// Retries transient failures (network, 5xx, 429) with exponential backoff.
public struct RetryPolicy {
    public var maxAttempts: Int
    public var baseDelay: TimeInterval
    public var maxDelay: TimeInterval
    public var sleep: (TimeInterval) async -> Void

    public init(maxAttempts: Int = 5, baseDelay: TimeInterval = 2, maxDelay: TimeInterval = 60,
                sleep: @escaping (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }) {
        self.maxAttempts = maxAttempts; self.baseDelay = baseDelay; self.maxDelay = maxDelay; self.sleep = sleep
    }

    public static func isTransient(_ error: Error) -> Bool {
        if error is URLError { return true }
        if case BridgeClientError.http(let s) = error { return s == 429 || s >= 500 }
        return false
    }

    public func run<T>(_ op: () async throws -> T) async throws -> T {
        var attempt = 0
        while true {
            do { return try await op() }
            catch {
                attempt += 1
                guard Self.isTransient(error), attempt < maxAttempts, !Task.isCancelled else { throw error }
                await sleep(min(maxDelay, baseDelay * pow(2, Double(attempt - 1))))
            }
        }
    }
}

/// Serializes sync runs and coalesces requests that arrive while one is running.
public actor SyncScheduler {
    private let run: @Sendable () async -> Void
    private var running = false
    private var again = false

    public init(run: @escaping @Sendable () async -> Void) { self.run = run }

    public func request() async {
        if running { again = true; return }
        running = true
        repeat {
            again = false
            await run()
        } while again
        running = false
    }
}

/// Fires `onChange` shortly after `CNContactStoreDidChange` (debounced), so a burst of
/// notifications becomes one sync within seconds.
public final class ContactsChangeMonitor {
    private var observer: NSObjectProtocol?
    private var pending: Task<Void, Never>?
    private let debounce: TimeInterval
    private let center: NotificationCenter

    public init(debounce: TimeInterval = 1.5, center: NotificationCenter = .default,
                name: Notification.Name = Notification.Name("CNContactStoreDidChangeNotification"),
                onChange: @escaping @Sendable () -> Void) {
        self.debounce = debounce
        self.center = center
        observer = center.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
            guard let self else { return }
            self.pending?.cancel()
            let d = self.debounce
            self.pending = Task {
                try? await Task.sleep(nanoseconds: UInt64(d * 1_000_000_000))
                if !Task.isCancelled { onChange() }
            }
        }
    }

    deinit {
        if let observer { center.removeObserver(observer) }
        pending?.cancel()
    }
}
