---
date: 2026-11-01
commonlib-version: "0.2.2"
self-hosted-livesync-version: "1.0.43"
status: accepted
---

# CLI database continuity

Publication note: the correction for #1304 is implemented and locally validated,
but has not been released. The reviewed baseline is Self-hosted LiveSync `0e458e5e` with
Commonlib `0.2.2`. The [CLI guide](../../src/apps/cli/README.md) describes the
command interface; the [test procedure](../../test/README.md#cli-fetch-database-continuity)
describes the Object Storage reproduction.

## Required behaviour

A successful `fetch` or `rebuild` must leave subsequent CLI commands using the
reconstructed local database. The Commonlib Rebuilder selects the host app ID
as the database suffix. The CLI saves that selection on success even without
`--write-settings`; the option continues to govern other lasting settings
changes. Temporary suspension values remain runtime state.

Before reconstruction can mutate a database, the CLI records the operation,
database directory, Vault path, and settings path. An interrupted operation
blocks ordinary mutation and synchronisation. Retrying the same reconstruction
with the same paths and `--force` is an explicit recovery action. It can repeat
the destructive operation, so users must preserve unique edits and establish
the authoritative copy before retrying.

Completion records the settings update before applying it. A later invocation
can finish a pending settings commit; if the settings file has independently
changed, it must stop for review rather than overwrite those changes. The
pending record is removed only after completion and settings persistence.

## Ownership of persistent state

The selected local database name identifies the dataset. Its runtime state is
further scoped by the canonical physical Vault path. This includes Journal
checkpoints, scanner state, replication-result queues, file-reflection
provenance, and storage-event snapshots. Paths identify local ownership; they
are not sent to the remote as a new document identity.

A local database reset invalidates every Vault scope associated with that
database, because each scope refers to the same discarded revision history.
Other local database suffixes retain their state. PouchDB database names and
Commonlib's reconstruction contract remain unchanged.

KV writes replace the file atomically. Invalid persisted data must fail
initialisation instead of becoming an empty checkpoint history. Closing a KV
handle must not overwrite the file from an old in-memory snapshot.

## Legacy state

The former shared `keyvalue-db.json` and Vault-local `.livesync-snapshot.json`
do not record their complete owner. A single surviving database directory does
not prove which physical Vault produced those records. Automatically importing
them can replay events against the wrong database; dropping them and immediately
scanning can misinterpret file absence before remote history is recovered.

Preserve unowned legacy state. When it contains work, stop ordinary mutating
commands and require explicit reconstruction from a verified source. Inspection
remains available. This deliberately requires more user action than automatic
migration, and must not silently delete the old records.

Check the selected scope's completion flag before reading legacy files. For an
unreviewed scope, inspect both legacy files after settings and scoped KV loading,
but before readiness starts scanning or event replay. Distinguish non-empty
unowned state, invalid JSON or shape, and read failures. Report affected paths
once per invocation on stderr without logging file contents. Read commands may
continue inspection; ordinary writes stop, and explicit reconstruction retains
the files. Once reconstruction has succeeded for that scope, legacy parse or
read failures must not block it again. The active scoped KV still fails
initialisation on corruption.

## Evidence and limits

The original Object Storage scenario uses encryption, path obfuscation, and a
second-generation file revision. Without settings writeback, A reopens an empty
database while sharing the fetched database's Journal history, creates an
independent root, and receives B's same-content resolution tombstone without
the original surviving revision. The original assertion fails because A's
physical file disappears. The explicit `--write-settings` control preserves
the file and the original revision. The remote and B retain the content in this
reproduction; it does not demonstrate irreversible loss.

Validation of the correction must check bytes and revision ancestry after
restart, interrupted reconstruction admission, pending settings completion,
legacy-state preservation, and reset isolation. A successful exit or an empty
queue alone does not establish preservation.

Local validation passed the encrypted Object Storage CLI regression and the
explicit-settings control on Node.js 26. Unit tests cover failed-operation
admission, saved running/completed markers, settings-edit preservation, scoped
stores, reset isolation, corrupt KV files, and legacy-state refusal. The marker
tests inject interruption states; they do not emulate a machine power failure.

The shared device-value JSON file retains its existing concurrency limitations.
This change does not establish concurrent CLI writers to one database directory
as a supported workflow. Native Obsidian and other transport behaviour require
their own runtime evidence.
