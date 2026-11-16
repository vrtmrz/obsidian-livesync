# Local database connection recovery

Status: unreleased implementation candidate for #1360. The revised design is
approved and has controlled Linux Obsidian verification. It
requires the matching unpublished combined Commonlib package. The reviewed
baseline remains Self-hosted LiveSync 1.0.50 with Commonlib 0.5.0; the registry
Commonlib 0.5.0 package does not contain the combined changes. Natural iOS
background connection loss and recovery on a physical iPhone remain unverified.

## Detection and ownership

On foreground return, the Obsidian host asks the database owner to run
`canReadCurrentDatabaseInfo()` against its current, initialised local Pouch
database. This is a probe of the database already owned by LiveSync; it does not
construct another Pouch database just to test whether the database exists. A
successful `info()` proves only that this operation succeeded. It does not
guarantee that later reads or writes, the native connection, or stored data are
healthy.

An actual failure from an operation owned by the current local database owner
requests this probe. The operation failure itself does not establish that the
database connection is lost. If the probe succeeds, no connection reopen is
needed. If it fails, the host holds new receiver dispatch, waits for already
started file work and its failure-retention work to settle, retires replication,
and asks the database owner to reopen the same selected database once. Recovery
does not depend on an error name, message, or nested cause. It does not patch
public Pouch methods or create a replacement database to inspect availability.

The owner serialises close and open with its existing lock and checks that it
still owns the selected database and that the settings select the same physical
database both before and after draining work. A concurrent explicit
open, close, or reset may change that selection. Recovery does not close a
replacement selected by another lifecycle operation; it checks the current
owner's database before releasing its hold. A successful same-database reopen
and recovery preparation are finite steps, not a guarantee of future database
operations.

## Resume and retained reflection work

After reopen, accepted local file work is completed before receiver dispatch is
released, and replication resumes only when the recovery preparation succeeds
and the app is visible and not suspended. Existing user and settings suspension
is preserved. The current failed operation is not replayed by the connection
observer. A failed local completion keeps work held and reports that restarting
Obsidian is required; recovery is not retried continuously.

An already-started received Metadata reflection retains its known document ID
and revision when the operation owner reports an incomplete result or throws.
The reflection owner awaits retention and the ordered snapshot save. Its target
selection remains the current Metadata revision and existing scanner or
received-entry policy; an older asynchronous result cannot replace a newer
target. The shared [reflection recovery design](chunk_transport_failure_recovery.md)
defines how the retained target becomes eligible for one automatic attempt.

Failure resources remain distinct. A local database operation failure waits for
same-database reopen and local recovery preparation. A remote content-read
failure waits for a successful finite pull or sync which can provide the
required content. If both resources are recorded, both must be ready before the
single automatic allowance can be consumed. A failure with no recognised
resource remains available for review and does not become automatically
retryable through error-name or cause inference. A failed snapshot save is not a
content-read failure and cannot be reported as a successful retention. Its
original exception reaches the caller. Snapshot writes await restoration so a
read failure cannot replace unread recovery records with an empty snapshot.

The key-value database has its own connection owner. Reopening the same local
Pouch database keeps that owner in place; reset, a logical database switch, and
application shutdown manage its separate lifecycle. Recovery preserves the
stored snapshot and retry allowance, and waits for the snapshot write to succeed
before dispatching an automatic attempt. Existence of a key-value handle alone
does not prove that the record was saved; a failed save prevents that dispatch.

The reflection scope owns operation resources, listeners, and running markers,
and awaits their asynchronous cleanup. The target scope separately owns target
identity and validity. Scope invalidation does not roll back a started write or
change scanner policy. Shutdown waits for started reflection work and retention
to settle before the existing key-value shutdown flush. Scanner-origin work
keeps its ordinary scan policy and is not elevated to forced Fetch.

## Verification boundary

### Previous candidate test record (historical)

The previous candidate's unit tests covered database-owner serialisation,
stale-owner rejection, local error observation, dispatch holding, foreground
ordering, shutdown, and competing explicit opens. A Commonlib PouchDB `idb` test
used fake IndexedDB to close a retained native handle, then checked database
identity, Chunk content, and revision preservation after reopening.

The previous connection-only candidate failed the controlled receiver scenario:
an injected native close during a received Metadata read left the target
unreflected after reopening. A previous integrated candidate retained that
target and reflected its exact content automatically, preserving revision and
provenance and accepting later local file work. This Linux Obsidian E2E run used
the real receiver without a remote server. It was run with
`npm run test:e2e:obsidian:focused -- database-recovery`, required the matching
Commonlib candidate and a discoverable Obsidian executable, and did not reproduce
an iOS background termination. These results describe those candidates only.

### Revised candidate verification

The revised candidate passes the controlled Linux Obsidian receiver test with
the combined Commonlib package. The test closes the native connection during a
received Metadata read, observes the retained snapshot before reopening, and
checks automatic reflection with unchanged content, revision, and provenance.
It also checks that later local file work is accepted. Unit regressions cover
snapshot failure propagation, shutdown draining, stale targets, and a cleanup
failure which must not register a completed reflection for retry.

The matching combined Commonlib package remains unpublished. Natural iOS
connection loss and recovery on a physical iPhone remain unverified. The
controlled test establishes recovery from its injected failure, not removal of
the operating-system trigger.

The Review Harness is observational. Its active-database samples are kept
separate from disposable-fixture evidence, with sample time and diagnostic stage
recorded. Its explicit fixture reopen is a manual diagnostic intervention, not
automatic product recovery. No controlled or background observation in the
Harness establishes that an iOS operating-system disconnect has been removed.

The shared lifecycle contract is maintained in Commonlib's
`docs/database-lifecycle.md`.
