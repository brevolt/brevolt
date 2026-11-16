// BRV-001 spike: Contacts change history from a Swift CLI.
// Safety: read-only by default; writes need --allow-write. Only synthetic contacts
// prefixed "ZZ-BRV-SPIKE" are created; deletion is by identifier from a manifest only.
// Never prints real contact data: history output is reduced to counts / manifest membership.
import CHShim
import Contacts
import Foundation

let prefix = "ZZ-BRV-SPIKE"
let author = "com.brevolt.spike"        // our transactionAuthor
let otherAuthor = "com.brevolt.other"    // simulates another app writing
let args = Array(CommandLine.arguments.dropFirst())
let allowWrite = args.contains("--allow-write")
let command = args.first(where: { !$0.hasPrefix("--") }) ?? "help"
let count = Int(args.first(where: { $0.hasPrefix("--count=") })?.dropFirst(8) ?? "1000") ?? 1000
let manifestURL = URL(fileURLWithPath: "manifest.json")

let store = CNContactStore()

func fail(_ m: String) -> Never { FileHandle.standardError.write(Data((m + "\n").utf8)); exit(1) }
func now() -> Double { Date().timeIntervalSince1970 }

struct Manifest: Codable { var groupID: String?; var contactIDs: [String] = [] }
func loadManifest() -> Manifest {
    (try? JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))) ?? Manifest()
}
func saveManifest(_ m: Manifest) { try? JSONEncoder().encode(m).write(to: manifestURL) }

// MARK: container

func localContainer() -> CNContainer {
    let cs = (try? store.containers(matching: nil)) ?? []
    guard let c = cs.first(where: { $0.type == .local }) else {
        fail("No local ('On My Mac') container; refusing to write elsewhere.")
    }
    return c
}

// MARK: history

struct HistorySummary { var add = 0, update = 0, delete = 0, dropAll = 0, other = 0, ours = 0 }

func readHistory(since token: Data?, excluding: [String]) throws -> (HistorySummary, Data?) {
    let req = CNChangeHistoryFetchRequest()
    req.startingToken = token
    req.excludedTransactionAuthors = excluding
    req.shouldUnifyResults = true
    req.additionalContactKeyDescriptors = []
    let manifestIDs = Set(loadManifest().contactIDs)
    var s = HistorySummary()
    var newToken: NSData?
    let events = try CHShim.fetchHistory(store, request: req, outToken: &newToken)
    for e in events {
        switch e {
        case let a as CNChangeHistoryAddContactEvent:
            s.add += 1; if manifestIDs.contains(a.contact.identifier) { s.ours += 1 }
        case let u as CNChangeHistoryUpdateContactEvent:
            s.update += 1; if manifestIDs.contains(u.contact.identifier) { s.ours += 1 }
        case let d as CNChangeHistoryDeleteContactEvent:
            s.delete += 1; if manifestIDs.contains(d.contactIdentifier) { s.ours += 1 }
        case is CNChangeHistoryDropEverythingEvent: s.dropAll += 1
        default: s.other += 1
        }
    }
    return (s, newToken as Data?)
}

func line(_ s: HistorySummary) -> String {
    "add=\(s.add) update=\(s.update) delete=\(s.delete) dropEverything=\(s.dropAll) other=\(s.other) (of which synthetic=\(s.ours))"
}

// MARK: writes

func syntheticContact(_ i: Int) -> CNMutableContact {
    let c = CNMutableContact()
    c.givenName = "\(prefix)-\(i)"
    c.familyName = "Synthetic"
    c.phoneNumbers = [CNLabeledValue(label: CNLabelWork, value: CNPhoneNumber(stringValue: "+34900\(String(format: "%06d", i))"))]
    return c
}

func createSynthetic(n: Int, author: String) throws {
    var m = loadManifest()
    let container = localContainer()
    if m.groupID == nil {
        let g = CNMutableGroup(); g.name = prefix
        let r = CNSaveRequest(); r.transactionAuthor = author
        r.add(g, toContainerWithIdentifier: container.identifier)
        try store.execute(r)
        m.groupID = g.identifier
        saveManifest(m)
    }
    let groups = try store.groups(matching: CNGroup.predicateForGroups(withIdentifiers: [m.groupID!]))
    guard let grp = groups.first else { fail("group missing") }
    var done = 0
    while done < n {
        let r = CNSaveRequest(); r.transactionAuthor = author
        let end = min(done + 100, n)
        for i in done..<end {
            let c = syntheticContact(i)
            r.add(c, toContainerWithIdentifier: container.identifier)
            r.addMember(c, to: grp)
            m.contactIDs.append(c.identifier)
        }
        saveManifest(m)      // manifest first: anything we may have created is recorded
        try store.execute(r)
        done = end
    }
}

func fetchSynthetic(ids: [String]) throws -> [CNContact] {
    let keys: [CNKeyDescriptor] = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactIdentifierKey].map { $0 as CNKeyDescriptor }
    return try store.unifiedContacts(matching: CNContact.predicateForContacts(withIdentifiers: ids), keysToFetch: keys)
}

func cleanup() throws {
    var m = loadManifest()
    var removed = 0
    // delete by manifest identifier only; re-check prefix as a second guard
    let ids = m.contactIDs
    for chunk in stride(from: 0, to: ids.count, by: 100).map({ Array(ids[$0..<min($0 + 100, ids.count)]) }) {
        let found = try fetchSynthetic(ids: chunk).filter { $0.givenName.hasPrefix(prefix) }
        let r = CNSaveRequest(); r.transactionAuthor = author
        for c in found { r.delete(c.mutableCopy() as! CNMutableContact); removed += 1 }
        try store.execute(r)
    }
    if let gid = m.groupID {
        let gs = try store.groups(matching: CNGroup.predicateForGroups(withIdentifiers: [gid])).filter { $0.name == prefix }
        let r = CNSaveRequest(); r.transactionAuthor = author
        for g in gs { r.delete(g.mutableCopy() as! CNMutableGroup) }
        try store.execute(r)
    }
    m = Manifest(); saveManifest(m)
    print("cleanup: removed \(removed) synthetic contacts and the group")
}

// MARK: commands

func requireAccess() {
    var granted = false
    let sem = DispatchSemaphore(value: 0)
    store.requestAccess(for: .contacts) { ok, _ in granted = ok; sem.signal() }
    sem.wait()
    if !granted { fail("Contacts access denied") }
}

func requireWrite() { if !allowWrite { fail("write command needs --allow-write") } }

requireAccess()

switch command {
case "containers":
    for c in try store.containers(matching: nil) { print("container type=\(c.type.rawValue)") }

case "token":
    print((store.currentHistoryToken ?? Data()).base64EncodedString())

case "run":
    // Full experiment. Needs --allow-write.
    requireWrite()
    let n = count
    let t0 = store.currentHistoryToken
    print("start token bytes:", t0?.count ?? 0)

    var t = now()
    try createSynthetic(n: n, author: author)
    print(String(format: "create %d synthetic (author=%@): %.2fs", n, author, now() - t))

    // 1. Without exclusion we see our writes; with exclusion we don't.
    let (all, tokAll) = try readHistory(since: t0, excluding: [])
    print("history since start, no exclusion:  ", line(all))
    let (excl, _) = try readHistory(since: t0, excluding: [author])
    print("history since start, excluding us:   ", line(excl))

    // 2. Full read timing of the synthetic contacts (group members), before any delete.
    let gid = loadManifest().groupID!
    t = now()
    let keys: [CNKeyDescriptor] = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey, CNContactIdentifierKey].map { $0 as CNKeyDescriptor }
    let fr = CNContactFetchRequest(keysToFetch: keys)
    fr.predicate = CNContact.predicateForContactsInGroup(withIdentifier: gid)
    var read = 0
    try store.enumerateContacts(with: fr) { _, _ in read += 1 }
    print(String(format: "full read of group: %d contacts in %.3fs", read, now() - t))

    // 3. Incremental read from saved token: add/update/delete by 'other' author.
    var m = loadManifest()
    let tokBefore = store.currentHistoryToken
    let r = CNSaveRequest(); r.transactionAuthor = otherAuthor
    let extra = syntheticContact(n + 1)
    r.add(extra, toContainerWithIdentifier: localContainer().identifier)
    m.contactIDs.append(extra.identifier); saveManifest(m)
    let upd = try fetchSynthetic(ids: [m.contactIDs[0]])[0].mutableCopy() as! CNMutableContact
    upd.familyName = "Updated"
    r.update(upd)
    let del = try fetchSynthetic(ids: [m.contactIDs[1]])[0].mutableCopy() as! CNMutableContact
    r.delete(del)
    try store.execute(r)
    let (inc, tokInc) = try readHistory(since: tokBefore, excluding: [author])
    print("incremental (other author, excl. us): ", line(inc))
    let (again, _) = try readHistory(since: tokInc, excluding: [author])
    print("re-read from returned token:         ", line(again))
    _ = tokAll

    // 4. Invalid/expired token behaviour.
    let bogus = Data("not-a-real-token".utf8)
    do {
        let (s, _) = try readHistory(since: bogus, excluding: [author])
        print("bogus token: no error; ", line(s))
    } catch let e as NSError {
        print("bogus token error: domain=\(e.domain) code=\(e.code) \(e.localizedDescription)")
    }
    // zero-length token
    do {
        let (s, _) = try readHistory(since: Data(), excluding: [author])
        print("empty token: no error; ", line(s))
    } catch let e as NSError {
        print("empty token error: domain=\(e.domain) code=\(e.code)")
    }

    try cleanup()

case "cleanup":
    requireWrite()
    try cleanup()

default:
    print("usage: contacts-history containers | token | run [--count=N] --allow-write | cleanup --allow-write")
}
