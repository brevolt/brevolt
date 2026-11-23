# BRV-035 manual checklist (test Mac, test iCloud account only)

Never use a real account or real contacts.

Setup: sign the test Apple ID into Contacts, run the bridge, set server URL, token and the iCloud container id, enable sync (grant Contacts access).

- [ ] First run uploads a full snapshot; the contacts appear in the dashboard.
- [ ] Add a contact on the iPhone: it reaches the hub within seconds of iCloud delivering it.
- [ ] Edit name, phone, email, address and birthday on the iPhone: the hub shows the change.
- [ ] Delete a contact on the iPhone: the hub records the deletion.
- [ ] Contacts in another container (e.g. On My Mac) are never uploaded.
- [ ] Disconnect the network, edit a contact, reconnect: the change arrives after the retry and nothing is lost.
- [ ] Quit and relaunch: only new changes are uploaded (no duplicates in the hub).
- [ ] Pause: edits are not uploaded; Resume uploads them.
