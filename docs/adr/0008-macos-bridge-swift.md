# ADR-0008: macOS bridge: Swift

- Status: Accepted (with open risks)
- Date: 2026-11-16
- Spike reports: [001](../spikes/001-contacts-history.md)

## Context

The bridge relays changes between the Contacts app and the hub using `CNChangeHistoryFetchRequest` and `CNSaveRequest`, and keeps its token in the Keychain (R-SEC-11). Spike 001 tested feasibility.

## Decision

A native Swift menu bar app (SwiftUI) in `apps/bridge-macos`, built with SwiftPM/Xcode, with a small Objective-C shim target for change history. Writes are tagged with `transactionAuthor = com.brevolt.bridge` and read with that author excluded.

## Alternatives considered

- Node/Electron wrapper: no direct access to Contacts framework without native modules, and a heavy menu bar app.
- AppleScript / Shortcuts: no change history, no reliable author tagging.
- Reading the AddressBook SQLite files: unsupported, fragile and permission-sensitive.

## Consequences

Spike 001 result: **works with limitations**. Consequences for the design:
- `enumeratorForChangeHistoryFetchRequest:error:` is `NS_SWIFT_UNAVAILABLE`: an Objective-C shim (~15 lines) is required in the same package.
- An expired or invalid token raises no error; the read returns `CNChangeHistoryDropEverythingEvent` plus all adds. R-BR-5: on `DropEverythingEvent`, discard incremental state and treat the batch as a full snapshot.
- Persist the new token only after the batch was processed; delete events carry only `contactIdentifier`.
- **Open risk:** only the local "On My Mac" container was tested (no iCloud/CardDAV), and real token expiry was only simulated. Must be re-checked on the test Mac with iCloud in phase 3 (BRV-035).
- Note: spike 001 ran on a real account (approved by @raul in BRE-2) because no test Apple ID exists; production-phase testing must use the test account.
