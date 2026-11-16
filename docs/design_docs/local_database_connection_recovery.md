# Local database connection recovery

Status: unreleased implementation candidate for #1360. The candidate integrates receiver retention from #1224 and requires its matching combined Commonlib package. Controlled Linux Obsidian verification demonstrates receiver recovery after an injected native connection close. Natural iOS background connection loss and recovery on a physical iPhone remain unverified.

The Obsidian host checks the existing, initialised local Pouch database before resuming after a visibility transition. A local public I/O `InvalidStateError` also requests that check. The same `info()` method is used for both local adapters; a successful result is a limited diagnostic because adapter internals may cache metadata or reopen a handle. This path does not construct a new Pouch solely to test whether a database exists.

If inspection also fails with `InvalidStateError`, the host clears physical database readiness, holds new file dispatch, settles dispatched file work, and retires replication. The Commonlib owner serialises close and open with `withLock` and checks the failed wrapper's identity inside that lock. Recovery never destroys the database. If an explicit open replaces the failed wrapper first, recovery checks that replacement and releases its own hold when the replacement is usable.

The existing key-value journal stays open during this connection replacement. After opening succeeds, the host completes accepted local file work and releases its receiver hold before permitted replication resumes. The receiver's user/settings suspension is preserved. A background failure waits for a foreground transition; a failed recovery is not retried continuously. A failed local completion prevents synchronisation resumption and requests an Obsidian restart.

The original failed operation retains its error. Writes are not replayed by the connection observer. An already dispatched ordinary receiver item records its known document ID and revision in the shared [reflection recovery](chunk_transport_failure_recovery.md) snapshot. The matching recovery completion permits one guarded retry, sharing its allowance with transport recovery. The connection observer itself does not replay the failed operation.

## Verification

- Unit tests cover owner serialisation, stale-owner rejection, local error observation, dispatch holding, foreground ordering, shutdown, and competing explicit opens.
- Commonlib's real PouchDB `idb` test closes a retained native handle under fake IndexedDB, then checks database identity, chunk content, and revision preservation after reopening.
- `npm run test:e2e:obsidian:focused -- database-recovery` builds the current plug-in and injects a native close during a received Metadata read in a temporary Obsidian Vault. It checks retention before reopening, automatic replacement, the received file's contents and reflection provenance, cleared pending work, retained Chunk content and revision, and subsequent local file persistence. It needs the matching Commonlib candidate installed and a discoverable Obsidian executable. It uses the real receiver without a remote server; it does not reproduce an iOS background termination.
- The Review Harness diagnostics remain observational. Their explicit fixture reopen is separate from automatic product recovery.

The receiver test fails against the earlier connection-only candidate: the injected Metadata read fails, and the received file remains absent after reopening. With the integrated candidate, the same scenario retains the target before reopening, reflects its exact content automatically, preserves its Metadata revision and provenance, clears completed pending work, and accepts subsequent local file work. This establishes the controlled recovery boundary, not the original iOS trigger or its frequency.

The shared lifecycle contract is maintained in Commonlib's `docs/database-lifecycle.md`.
