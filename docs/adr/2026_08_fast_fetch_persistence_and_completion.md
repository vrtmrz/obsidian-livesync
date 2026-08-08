# Architectural Decision Record: Fast Fetch Persistence and Completion Semantics

## Status

Accepted

## Context

Fast Fetch accelerates Fast Setup (Simple Fetch) by reading CouchDB's continuous
changes feed directly, decrypting each document, and writing batches to the local
database. It then allows LiveSync to reflect the completed database into the
Vault.

This path deliberately bypasses PouchDB's ordinary replication machinery. It
must therefore reproduce the correctness guarantees on which the rest of the
initialisation workflow relies:

- a remote document is decrypted and validated before it is written locally;
- every result from a batch write is checked;
- a checkpoint represents the last contiguous remote sequence which is durable
  in the local database; and
- successful completion means that the captured remote target has been reached,
  rather than that an estimated number of documents has been received.

The existing implementation combines line parsing, decryption, persistence, and
completion checks within one broad error handler. A decryption or persistence
failure can consequently be reported as a malformed JSON line and skipped. A
batch write can also resolve while containing individual failed results. In both
cases the stream may continue, advance its checkpoint incorrectly, or wait
indefinitely for a completion condition which the failed row would have
satisfied.

Fast Fetch also estimates the number of documents from the changes feed's
`pending` value. That value is useful for progress reporting, but it is not an
authoritative completion boundary. The CouchDB sequence token is opaque and must
be handled using CouchDB's sequence semantics, without numeric-prefix comparison
or inferred row counts. On clustered CouchDB, database information and the
changes feed may encode the same position with different opaque tokens, so an
`update_seq` from database information must not be compared directly with a
changes-feed row.

## Decision

### Remote snapshot and completion

Fast Fetch must obtain an authoritative target token from a normal changes-feed
snapshot before consuming the stream. A request from `since=now` with no result
rows provides a token in the same sequence domain as the streamed rows. If that
target cannot be obtained, the fetch fails instead of falling back to a database
information token, a document-count estimate, or another approximate sequence.

The target token is treated as opaque. Fast Fetch completes only after the row
for the captured target has been processed and all work up to that row has been
persisted successfully. When a status request proves that no changes exist after
the current durable checkpoint, the captured target may be checkpointed without
opening the continuous stream. This includes an empty remote database. Changes
made remotely after the target was captured are outside this Fast Fetch snapshot
and are left for subsequent ordinary replication.

The estimated document count remains available for progress reporting only. It
must not determine success.

### Processing and persistence

Each non-blank line from the changes feed is processed through these ordered
stages:

1. parse and validate the changes-feed row;
2. decrypt and validate its document, when a document is present;
3. add the document to the pending local batch;
4. persist the batch; and
5. inspect every result returned by the batch write.

With `new_edits: false`, PouchDB follows CouchDB behaviour and may omit successful
results. Fast Fetch therefore inspects every returned result and treats any
error result as a failed batch. An empty result is valid when PouchDB accepted
the complete batch.

The checkpoint may advance only to the last contiguous sequence for which all
preceding documents are durable. A row which legitimately requires no local
write may advance the checkpoint only after any preceding buffered documents
have been flushed successfully. The target sequence is committed under the same
rule before the operation reports success.

If a batch is partly written, its checkpoint is not advanced. Retrying the batch
with `new_edits: false` is expected to be idempotent, including for documents
which were accepted during the first attempt.

Blank heartbeat lines are ignored. Malformed rows are failures; they are not
silently skipped. Logs may describe the stage and sequence involved, but must
not include the raw changes-feed line because it may be large or sensitive.

The continuous changes request and its decoded reader must be terminated on
every exit. Releasing a reader lock alone does not cancel the underlying
request. Failure and completion paths therefore abort the request and attempt
to cancel the reader before the bounded remote-activity scope ends.

### Failure classification and retry

The streaming boundary returns a small structured failure with a stage and an
explicit retryability decision. The initial stages are:

```typescript
type StreamingFetchFailureStage = "transport" | "authentication" | "protocol" | "decryption" | "storage";
```

This type is an internal behavioural contract, not a user-interface status
enumeration. It may carry safe diagnostic context, such as an HTTP status or a
sequence token, without carrying document content.

Only explicitly recognised transient transport failures are retried
automatically. Examples include an interrupted connection, HTTP 408, HTTP 429,
and selected HTTP 5xx responses. Authentication, protocol, decryption, and local
storage failures are terminal by default. A future implementation may recognise
a narrower retryable case, but it must do so explicitly rather than retry every
exception.

Each retry resumes from the last durable contiguous checkpoint. Retry exhaustion
returns an actionable classified failure to the caller.

### Initialisation lifecycle

Fast Fetch success is the only path which may continue with the offline scan,
finish the rebuild, resume Vault reflection, clear the Fast Fetch checkpoint,
remove the flag file, or forget the remembered initialisation choice.

The LiveSync initialisation boundary uses an explicit suspension policy.
Ordinary Fetch and Rebuild resume Vault reflection when they finish, SCRAM keeps
file watching suspended, and Fast Fetch keeps both file watching and replication
result parsing suspended only when initialisation fails. Fast Fetch asserts both
suspensions before it begins and owns their final state: success clears both,
whereas a false result or exception sets both. This final assignment also covers
a late failure after rebuild finalisation and the legacy
`doNotSuspendOnFetching` path.

On failure:

- the local checkpoint and any durably fetched documents are retained for a
  later retry;
- the local database is not marked as resolved;
- Vault reflection remains suspended;
- the offline scan and rebuild finalisation are not run; and
- the flag file and remembered initialisation choice remain available so that
  restart recovery can offer the same operation again.

Any bounded remote-activity scope must still be released in a `finally` path, as
defined by [Bounded Remote Activity](2026_07_bounded_remote_activity.md). Keeping
Vault reflection suspended does not permit a wake lock or similar resource to
leak.

## Ownership

The responsibilities are divided at three injectable boundaries.

### Streaming Fetch

The Commonlib streaming implementation owns HTTP response validation, NDJSON
parsing, invocation of the decryption delegate, batch-write result validation,
contiguous checkpoint advancement, target-sequence completion, and classified
failures. It does not know about the Vault, setup dialogues, flag files, or
LiveSync settings.

### Rebuilder

The Commonlib rebuilder owns the local database lifecycle, checkpoint storage,
retry policy, marking a completed database as resolved, optional resumption of
reflection, and final checkpoint removal. It does not parse changes-feed rows or
interpret user-interface choices.

### LiveSync Fast Setup

LiveSync owns the setup choices, suspension of initial Vault reflection,
invocation of Fast Fetch, the success-only offline scan and rebuild finalisation,
and cleanup of flag files and remembered choices. It does not reinterpret
document, encryption, or storage failures as successful setup.

## Non-Goals

This decision does not:

- change the Metadata and Chunks formats, encryption scheme, security seed, or
  path obfuscation;
- change ordinary PouchDB replication, Standard Fetch, or offline-scan
  semantics;
- provide a transaction spanning CouchDB and the local database;
- skip corrupt or unreadable documents and continue with a partial database;
- add an automatic fallback from Fast Fetch to Standard Fetch;
- define the detailed failure dialogue or other setup user-interface changes;
  or
- require Fast Fetch to include remote changes made after its captured target.

An explicit Standard Fetch choice remains available when a user needs the
ordinary replication path. Any automatic fallback or richer recovery dialogue
requires a separate decision because it changes user-visible setup behaviour.

## Verification

The implementation is verified primarily with London School interaction tests,
using mocks at each owned boundary to prove collaboration and call order.

### Streaming Fetch unit tests

Inject the HTTP stream, decryption delegate, local batch writer, and checkpoint
writer. Verify that:

- the order is decrypt, persist, inspect results, then checkpoint;
- parsing, decryption, and batch-result failures prevent checkpoint advancement
  and completion;
- a partly failed batch leaves the checkpoint unchanged and reports a storage
  failure;
- rows without a local write flush earlier buffered documents before advancing;
- an estimated document count cannot complete the fetch;
- the captured target cannot complete the fetch before its batch is durable;
- authentication and malformed-protocol responses are terminal;
- recognised transient transport failures are classified as retryable; and
- diagnostics do not log the raw changes-feed line.

### Rebuilder unit tests

Inject the streaming operation and lifecycle collaborators. Verify that:

- transient failures retry from the latest durable checkpoint;
- terminal failures are attempted once;
- success marks the database as resolved, resumes reflection when requested, and
  clears the checkpoint in that order; and
- failure does not mark the database as resolved, resume reflection, or clear
  the checkpoint.

### LiveSync orchestration unit tests

Inject Fast Fetch, the offline scanner, rebuild finalisation, and cleanup
collaborators. Verify that failure performs none of the success-only actions and
leaves initial Vault reflection suspended. Verify that success retains the
existing setup sequence and cleanup.

### Integration and E2E tests

Commonlib's CouchDB integration test remains responsible for the real HTTP
changes feed, opaque sequence tokens, and local batch persistence. It should
include a data set large enough to cross a batch boundary and confirm that the
final checkpoint equals the captured target.

LiveSync's real Obsidian Setup URI workflow remains responsible for the actual
Fast Fetch selection, E2EE passphrase, Vault reflection, ordinary file round
trip, and hidden-file synchronisation. Injected parsing, decryption, and
persistence failures remain unit-test responsibilities; repeating them through
the real Obsidian E2E does not add coverage for an unchanged framework boundary.
This follows [Real Obsidian E2E](2026_06_real_obsidian_e2e.md).

## Consequences

- A deterministic document failure which previously appeared to be skipped now
  fails Fast Fetch. This is an intentional safety improvement because the local
  database is known to be incomplete.
- Partial durable work and its contiguous checkpoint can be reused by a later
  attempt without exposing the partial database to the Vault.
- Retry delays are no longer spent on authentication, corrupt content, protocol,
  or local persistence failures which cannot repair themselves.
- Progress totals remain approximate and may change without affecting
  correctness.
- The implementation requires coordinated changes in Commonlib and LiveSync.
  Commonlib remains the authoritative package for streaming and rebuilder
  behaviour; LiveSync consumes an immutable Commonlib release and owns its setup
  orchestration.
- Ordinary replication remains unchanged and continues to provide the reference
  correctness contract for decrypting, persisting, and checkpointing replicated
  documents.
