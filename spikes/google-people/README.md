# BRV-002 spike: Google People API sync

Dependency-free Node (>= 20) script. Test Google account only. See `docs/spikes/002-google-people.md`.

```sh
cd spikes/google-people
cp .env.example .env            # fill with the test account's own OAuth client (git-ignored)
node --env-file=.env spike.mjs auth                      # OAuth + PKCE, stores refresh token in .tokens.json
node --env-file=.env spike.mjs list                      # full listing + syncToken
# change a contact in contacts.google.com, then:
node --env-file=.env spike.mjs sync                      # incremental listing
node --env-file=.env spike.mjs update people/cXXXX Smith # update with fresh etag
node --env-file=.env spike.mjs stale-etag people/cXXXX   # second write with obsolete etag
node --env-file=.env spike.mjs expired [oldSyncToken]    # expired/invalid syncToken
node --env-file=.env spike.mjs quota                     # bounded read burst until 429
```

Fixtures are written to `fixtures/` already anonymized (ids, emails, phones, names, tokens, etags). Review them before committing.
