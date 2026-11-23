# bridge-macos

SwiftUI menu bar app that relays changes between Contacts and the Brevolt hub. Not part of the pnpm workspace.

- `Sources/BridgeCore`: settings, Keychain token storage, HTTPS client for `/v1/bridge/*`, sync state.
- `Sources/BrevoltBridge`: menu bar UI (status, Sync now, Pause, settings, launch at login).
- Test: `cd apps/bridge-macos && swift test`.

Security: the API token lives only in the Keychain (R-SEC-11); `UserDefaults` holds non-secret settings. The client requires `https` and uses system certificate validation. Contacts access is requested only when sync is enabled. The sync engine arrives in BRV-035/036.
