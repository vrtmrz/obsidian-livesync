# Architectural Decision Record: CouchDB Remote Connection Ownership

## Status

Accepted. The first implementation is deliberately limited to the
abort-capable CouchDB connectivity preflight used by one-shot replication.

## Context

Commonlib opens a remote CouchDB database through `RemoteService.connect()`.
Before this decision, a successful call returned only a PouchDB handle and an
information snapshot:

```typescript
{
    db: PouchDB.Database<EntryDoc>;
    info: PouchDB.Core.DatabaseInfo;
}
```

The value did not state who must close the handle or how requests which outlive
the current operation are cancelled. Callers consequently accumulated their
own `try`/`finally` blocks and closing helpers. Commonlib PR 112 made finite
handle clean-up substantially safer, but closing a raw PouchDB handle still did
not define ownership of its outstanding HTTP work.

A remote PouchDB HTTP handle is not a dedicated socket. `db.close()` emits
PouchDB's normal `closed` event and closes the logical handle, but the HTTP
adapter does not establish that a pending browser fetch or response-body read
has stopped. `RemoteService.performFetch()` also records a physical request as
complete once response headers have arrived, while PouchDB may still be reading
and parsing the body. Neither the request counters nor raw `db.close()` can
therefore prove that the transport work has settled.

One-shot CouchDB replication performs the following work before it creates the
replication controller:

1. prepare the encryption security seed;
2. construct the remote PouchDB handle and read database information;
3. check and, where required, migrate the remote database version;
4. read and update compatibility Metadata, including the milestone document;
   and
5. create the PouchDB replication operation.

The controller owned by `processSync()` begins only at step 5. A request which
never settles during steps 2 to 4 is outside that cancellation scope. The
shared one-shot result remains pending as well, so later triggers join the same
pending operation rather than beginning a fresh attempt.

Self-hosted LiveSync issue 1116 provides evidence of this failure shape. On one
Linux and Electron combination, a one-shot attempt remained pending while
writing the remote milestone document. Bypassing that write allowed the
attempt to reach later replication requests. A local real-Obsidian exercise
reproduced the preceding Fast Fetch state but not the indefinite write. The
evidence does not establish a milestone-specific defect, a CouchDB defect, a
browser connection-pool defect, or a lock cycle. It does establish that the
connectivity preflight lacks an owner which can terminate its abort-capable
transport work.

No code-level circular wait has been identified. `shareRunningResult()` shares
a logical promise, the remote-activity counters observe work, and the global
replication concurrency controller is entered only after the preflight. Adding
a semaphore or another connection lock would let a stalled request retain the
permit; it would not make that request settle.

## Decision

### Extend the existing connection result

Commonlib will define the owned connection as the existing flat result with one
additional operation:

```typescript
interface RemoteConnectionOpenOptions {
    readonly signal?: AbortSignal;
    readonly allowNativeFallback?: boolean;
}

interface OwnedCouchDBConnection<T extends object> {
    readonly db: PouchDB.Database<T>;
    readonly info: PouchDB.Core.DatabaseInfo;
    close(): Promise<void>;
}

interface CouchDBReplicationConnection extends OwnedCouchDBConnection<EntryDoc> {
    readonly syncOptionBase: PouchDB.Replication.SyncOptions;
    readonly syncOption: PouchDB.Replication.SyncOptions;
}
```

`RemoteService.connect()` remains the entry point. It returns
`OwnedCouchDBConnection` directly; there is no nested resource wrapper, separate
lease API, public connection signal, or public `abort()` operation. The
connection and checked replication types are owned and documented by
Commonlib. Compatibility checks enrich the same connection with replication
options instead of creating another lifetime object.

The following properties are part of the contract:

- `close()` is idempotent;
- `close()` first cancels abort-capable requests scoped to the connection, then
  calls PouchDB's ordinary `db.close()`;
- PouchDB retains its normal `closed` event behaviour;
- the optional input signal cancels the same internal request scope;
- skipping the information request retains the established placeholder in
  `info` for source and behaviour compatibility;
- a close failure is reported diagnostically but does not replace the primary
  replication result; and
- ownership of the connection does not imply ownership of a dedicated physical
  HTTP socket.

The public connection does not expose its internal signal because no caller
needs to make a second shutdown decision. Owners either cancel through the
input signal or finish through `close()`. This leaves one operation responsible
for final clean-up.

Replacing the existing error-string union with a typed connection-failure
result remains desirable, but it is outside this change. Mixing that migration
into the first implementation would enlarge the consumer and user-message
surface without improving cancellation.

### Bind cancellation at the custom fetch boundary

`RemoteService.connect()` creates its internal request scope before PouchDB is
constructed, so the initial `db.info()` request is covered. The custom PouchDB
fetch implementation combines, without replacing, both applicable signals:

- the signal supplied by PouchDB for the individual request; and
- the signal for the owned connection, which follows its optional owner signal.

The combined signal remains applicable while the response body is consumed.
Receiving response headers is not the end of cancellation ownership.

Cancellation is not a CORS failure. If the connection scope has been aborted,
the request must not enter the diagnostic fallback from the web-compatible
fetch path to the native request API. A bounded owner can also disable that
fallback explicitly.

The web-compatible fetch path honours `AbortSignal`. Obsidian's current native
`requestUrl` adapter does not expose physical cancellation through
`RequestInit.signal`. The implementation must not use `Promise.race()` to
declare a native remote write cancelled while it may still complete. A bounded
guarantee therefore applies only where the selected request path remains
abort-capable.

### Transfer the same connection between owners

At every point, exactly one operation is responsible for calling `close()`:

1. `RemoteService.connect()` owns the connection until it returns successfully;
2. the connectivity preflight owns it while checking version and compatibility;
3. a successful preflight transfers the same connection to the one-shot or
   continuous replication operation; and
4. the final replication owner closes it after replication settles or is
   terminated.

A failed factory or preflight closes the connection in its own failure path. A
successful transfer clears the former owner's deadline before replication
continues. Borrowing `connection.db` does not transfer close responsibility.

`shareRunningResult()` owns no connection. It may share the result of an
operation which owns one, but that operation must settle and close the
connection before the shared entry can be released for a later attempt.

## Limited Introduction

The first bounded consumer is the CouchDB connectivity preflight reached from
one-shot replication. Its boundary includes:

- PouchDB construction and the initial `db.info()` request;
- the database-version check and migration negotiation; and
- compatibility and milestone reads and writes before replication starts.

The preflight receives an internal 60-second wall-clock deadline. This is a
last-resort safety fuse for an owner which would otherwise remain pending
indefinitely. It is not the expected completion time, a service-level target, a
per-request inactivity timeout, a user setting, a limit on replication
duration, or the `useTimeouts` changes-feed setting. Tests inject a shorter
deadline.

When that deadline expires on the web-compatible path:

1. the owner signal aborts the connection's request scope;
2. the preflight closes the connection;
3. no PouchDB replication operation is created;
4. the shared one-shot result settles as failed; and
5. a later trigger may create a fresh connection and attempt.

On success, the deadline is cleared before the connection is transferred to
replication, so an old timer cannot interrupt a healthy long-running transfer.

The explicitly selected native Request API retains its previous unbounded
behaviour because its host adapter cannot honour transport cancellation. The
security-seed preparation which precedes the shared one-shot operation is also
outside this first boundary. Fast Fetch, setup probes, maintenance commands,
status inspection, and other direct CouchDB consumers retain their existing
deadline and retry policies. They receive the additive `close()` contract but
are not silently given this one-shot deadline.

The first implementation does not add automatic retry. Retrying before the old
request is known to be cancelled could duplicate remote writes or consume more
connections without changing the failing condition.

## Ownership

The legacy `_ensureConnection()` method retains its raw PouchDB return type for
source compatibility. New Commonlib paths use an internal owned-connection
helper and do not discard the lifecycle object.

Commonlib owns:

- `OwnedCouchDBConnection`, `RemoteConnectionOpenOptions`, and
  `CouchDBReplicationConnection`;
- composition of PouchDB request and connection cancellation signals;
- the PouchDB custom-fetch integration;
- idempotent connection close behaviour;
- ownership transfer within the CouchDB replicator; and
- timeout classification at the connectivity-preflight boundary.

Self-hosted LiveSync owns:

- the concrete Obsidian fetch adapters and their declared capabilities;
- user-facing logs or notices for a timed-out attempt;
- integration of an immutable Commonlib release; and
- real-Obsidian validation of the affected consumer path.

No host may claim physical cancellation unless its injected fetch
implementation honours the supplied signal.

## Non-Goals

This decision does not:

- identify the exact environmental cause reported in issue 1116;
- guarantee that a one-shot attempt succeeds;
- special-case the milestone document or its URL;
- impose a global connection limit or connection semaphore;
- add an automatic retry, fallback, or remote reconciliation policy;
- apply a deadline to ordinary replication, continuous changes feeds, Fast
  Fetch, rebuilds, or bulk transfers;
- change CouchDB documents, checkpoints, encryption, the security seed, or
  compatibility Metadata;
- make `close()` equivalent to closing a browser socket;
- detach a potentially mutating native request and report it as cancelled; or
- migrate every direct PouchDB borrower to the one-shot deadline policy.

## Alternatives Rejected

### Time out only the milestone write

The observed write is where one report stopped, not an established ownership
boundary. Another environment could stop at `db.info()`, version Metadata,
response-body parsing, or an adjacent compatibility request.

### Race the preflight without cancelling its transport

This would release `shareRunningResult()` while the old request remained able
to complete. It is especially unsafe for a remote `PUT`, because a later
attempt could begin after the first had been reported as failed.

### Add a global semaphore or lower the connection count

No connection-limit failure has been demonstrated. A stalled owner would
retain its permit indefinitely and turn an unexplained request into an explicit
queue deadlock.

### Add a separate lease wrapper

A nested `{ connection: { db, close }, info }` result would make ownership
visible, but it would duplicate the existing connection shape, force callers
through another projection, and expose lifetime operations which have no
consumer. Adding `close()` to the existing value preserves source compatibility
and keeps the PouchDB handle, information snapshot, and lifetime together.

### Share one global remote PouchDB handle

A singleton would couple setup, maintenance, one-shot, and continuous
lifecycles, make credential and setting changes harder to isolate, and turn one
stalled request into a process-wide resource.

## Verification

The regression tests were changed before the implementation. Against the old
flat result they demonstrated that:

- an owner signal left an in-flight request pending;
- the result had no `close()` operation capable of interrupting a body read;
- a bounded web-compatible request could enter the native fallback; and
- the one-shot path still depended on the discarded nested connection API.

After the change, focused Commonlib tests verify that:

- an owner signal settles a pending request;
- `close()` interrupts a response body read before closing PouchDB;
- repeated `close()` calls close the handle once;
- an aborted or bounded request does not enter the non-abortable native adapter;
- deadline expiry closes the same flat connection and releases the shared
  one-shot attempt;
- a later invocation begins after that release;
- a successful preflight clears its deadline and transfers ownership; and
- close failures are logged without replacing timeout or replication results.

Type checking and package-boundary checks verify the Commonlib-owned
declarations and compatibility export. Self-hosted LiveSync must then validate
the exact packed Commonlib artefact with its focused consumer tests and an
ordinary real-Obsidian and CouchDB smoke test. The reporter's environment
remains the validation boundary for the original platform-specific symptom.

## Consequences

- A successful remote connection has one explicit close operation without a
  parallel lease abstraction.
- Existing `{ db, info }` consumers remain source-compatible and may adopt
  `close()` without changing their projections.
- One-shot connectivity can become a bounded failure on an abort-capable
  transport instead of retaining the shared operation indefinitely.
- Native `requestUrl` cancellation remains an acknowledged gap rather than a
  falsely satisfied contract.
- Other finite consumers can adopt owner signals and explicit `close()` one at
  a time, with tests for their own side effects and retry policies.

## References

- [Bounded Remote Activity](2026_07_bounded_remote_activity.md)
- [Fast Fetch Persistence and Completion Semantics](2026_08_fast_fetch_persistence_and_completion.md)
- Commonlib PR 112, which closes finite remote PouchDB handles after their
  logical owners settle
- Self-hosted LiveSync issue 1116, which reports a one-shot compatibility write
  remaining pending on one Linux and Electron environment
