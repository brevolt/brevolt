# Spike 001 · Contacts change history on macOS (BRV-001)

**Result: works with limitations.** Requirements: R-BR-1, R-BR-3, R-BR-5.
Code: `spikes/contacts-history/` (SwiftPM, `swift build`). macOS 27 / Swift 6.4, local "On My Mac" container.

## Summary

| Criterion | Result |
|---|---|
| Adds, updates and deletes from a saved token | OK: 1 add + 1 update + 1 delete detected with `CNChangeHistoryFetchRequest` |
| `transactionAuthor` + `excludedTransactionAuthors` | OK: 1,000 adds visible without exclusion, 0 with our author excluded; a different author still shows up |
| Full read of 1,000 synthetic contacts | ~0.026 s (1,000 contacts, `enumerateContacts` filtered by group; keys: given name, family name, phone numbers) |
| Expired/invalid token | No error is raised; see below |

Writing 1,000 contacts in batches of 100 takes ~4 s.

## Limitations

1. **`enumeratorForChangeHistoryFetchRequest:error:` is `NS_SWIFT_UNAVAILABLE`.** It cannot be called from Swift directly: a small Objective-C shim (`Sources/CHShim`, ~15 lines) is needed in the same SwiftPM package.
2. **An expired or corrupt token does not raise an error.** With a made-up or empty token the read returns the full history: a `CNChangeHistoryDropEverythingEvent` followed by all adds. R-BR-5 is therefore detected like this: if a `DropEverythingEvent` appears, discard incremental state and treat the batch as a full snapshot. There is no error code to check.
3. Take `currentHistoryToken` before writing; the token returned by each read (`CNFetchResult.currentHistoryToken`) is the one to persist. Re-reading from it returns 0 events.
4. With `shouldUnifyResults = true` events arrive unified; deletes carry only `contactIdentifier`, not the contact data.
5. Only the local container was tested (no iCloud/CardDAV), and real expiry by time or history size was not measured; expiry was only simulated with an invalid token.

## Reusable snippets

Tagged write (R-BR-3):

```swift
let r = CNSaveRequest()
r.transactionAuthor = "com.brevolt.bridge"
r.add(contact, toContainerWithIdentifier: containerID)
try store.execute(r)
```

Incremental read excluding our own writes (R-BR-1/3/5):

```swift
let req = CNChangeHistoryFetchRequest()
req.startingToken = savedToken               // nil = from the beginning
req.excludedTransactionAuthors = ["com.brevolt.bridge"]
req.shouldUnifyResults = true
var newToken: NSData?
let events = try CHShim.fetchHistory(store, request: req, outToken: &newToken)
for e in events {
    switch e {
    case let a as CNChangeHistoryAddContactEvent:    /* a.contact */
    case let u as CNChangeHistoryUpdateContactEvent: /* u.contact */
    case let d as CNChangeHistoryDeleteContactEvent: /* d.contactIdentifier */
    case is CNChangeHistoryDropEverythingEvent:      /* invalid token -> full snapshot */
    default: break
    }
}
// persist newToken only after processing succeeded
```

## Spike safety

Run on raul's real account (no test Apple ID exists; approved by raul in BRE-2), only in the local "On My Mac" container (the CLI aborts if it is missing). Synthetic `ZZ-BRV-SPIKE` contacts in their own group; deletes only by manifest identifier (with a second prefix check); writes behind `--allow-write`; no contact data printed. Verified at the end: 0 `ZZ-BRV-SPIKE` contacts and 0 groups remain.

## Usage

```
swift build
.build/debug/contacts-history containers
.build/debug/contacts-history run --count=1000 --allow-write
.build/debug/contacts-history cleanup --allow-write
```
