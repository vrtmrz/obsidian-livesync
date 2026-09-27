---
date: 2026-09-27
commonlib-version: "0.1.30"
self-hosted-livesync-version: "1.0.32"
status: unreleased
---

# Internal Metadata encryption and remote feature changes

This document defines the LiveSync integration of Commonlib's remote feature
contract and encrypted Metadata for Hidden File Sync and Customisation Sync.
It describes unreleased behaviour being implemented in this branch.

Commonlib's companion `docs/remote-feature-compatibility.md` is the
source of truth for the wire document, identifiers, validation, and shared
assessment. This document owns the application behaviour, settings, Doctor
recommendation, and verification of the Obsidian and CLI integrations.

## Scope and settings

Add `encryptInternalMetadata` to the shared encryption settings. A genuinely new
Vault or CLI configuration defaults to true. Existing stored settings and old
Setup URI or QR imports complete an absent value as false. Ordinary partial
setting updates retain the current value.

The preference applies to CouchDB with E2EE V2 and Property Encryption enabled.
Show the preference as unavailable and explain its prerequisites when they are
absent. Keep Journal and P2P's existing
transport protection and avoid unrelated setting mismatches for those remotes.

Use the existing HKDF Metadata representation to protect path, creation and
modification times, size, and Chunk references for obfuscated internal entries.
Keep the `i:`, `ix:`, and supported legacy `ps:` document IDs, path conversion,
and content Chunk representation. Read encrypted Metadata independently of the
write preference, including after that preference is disabled.

The protection leaves document IDs, namespaces, revisions, deletion state,
document counts, and ciphertext lengths visible. It does not encrypt device or
Vault names stored in separate participant records.

## Enabling the preference

Changing the preference does not automatically reconstruct a database or gather
all devices' data. It affects subsequent Metadata writes. Unchanged documents
and old revisions can retain plaintext; mixed plaintext and encrypted Metadata
are a supported transition state.

Strongly recommend the existing manual remote Rebuild workflow when the person
wants existing Metadata protected as well. The person prepares the authoritative
data for that workflow. Describe this distinction in the setting, Doctor reason,
and operational documentation. Do not advertise complete historical protection
merely because the preference is enabled.

Copy the preference with the other encryption settings when preparing a remote
profile. Recreate a connection when its effective encryption settings change.
Use the existing Tweak assessment and manual mismatch resolution; do not change
the remote's shared policy silently when importing or loading settings.

## Doctor

Use Commonlib's existing conditional recommendation rules. Recommend true when
the selected CouchDB settings have E2EE V2 and Property Encryption enabled and
the new preference is false. Do not require Hidden File Sync or Customisation
Sync to be active before offering the recommendation.

Retain the existing E2EE V2 recommendation for a legacy algorithm. After that
change, ensure the newly applicable Metadata recommendation is not hidden by a
premature `doctorProcessedVersion` update. Advance the Doctor rule revision so
an older completed consultation does not suppress this new recommendation.

Apply the preference only when the person accepts the recommendation. Include
the existing-data limitation, the manual Rebuild recommendation, and the need
for compatible clients in the explanation. Do not set `requireRebuild` or
`requireRebuildLocal` for this rule: the current host wrapper can schedule those
operations and restart. `recommendRebuild` currently exists only as an unused
rule field, so setting it alone does not display an explanation.

## Receiving a changed version document

The existing path is:

1. Commonlib receives a CouchDB replication change and calls
   `parseSynchroniseResult` with the received documents.
2. The replication service feature passes them to
   `ReplicateResultProcessor.enqueueAll`.
3. `processIfNonDocumentChange` recognises `type: versioninfo` and requests active
   Replicator retirement when `version > VER`.
4. The owner closes admission, requests transfer cancellation, drains its work,
   and closes the instance. The result callback does not wait for that transition.

Retain this observation path, but use Commonlib's complete assessment of the
identified control document. A changed `used_features` list must be inspected
even when the numeric version is unchanged. A mere revision change, list reorder,
or duplicate known identifier does not require an interruption.

Inspect the entire batch's control information before passing any file entries
to normal or optional processing. Recognise the fixed control-document ID and
validate its type and contents. A deleted or malformed control document is a
rejection, not a successful empty update.

When all requirements remain supported, refresh the assessment and affected
shared-setting checks; a newly added feature retires the current writer so its
next admission rechecks the shared Tweak policy. When a requirement is
unknown or incompatible, synchronously record the block for the affected
database, stop admitting new reflection and database operations, and request
retirement through the existing owner. Notify with the unknown identifiers as
text, using a generic message when no descriptive label exists.

File application and remote transfer have separate lifetimes. Requesting owner
retirement alone is not the application block. Keep the block separate from
temporary lifecycle suspension so an ordinary resume event cannot clear it.
Queued or waiting work checks it before starting another write; notifications
from an old physical database must not affect its replacement.

Do not await `onCloseActiveReplication` inside the callback which delivered the
change. That callback can belong to work which retirement must drain. Establish
the block immediately, request retirement without awaiting it there, and let the
owner perform cancellation and close in its existing order.

## Persistence and recovery boundaries

A CouchDB replication notification can arrive after the documents have entered
the local DB. Already-started network and filesystem operations may settle.
This feature does not promise rollback or atomic revocation of those operations.

Preserve pending work or durable reconciliation information when stopping. A
checkpoint may already include the documents which have not reached the Vault.
Do not drop those documents or depend on an ordinary reconnect to send them
again. A compatible client must reassess and reprocess or explicitly reacquire
them before lifting the applicable block.
Persist a blocked pending-work snapshot before the received-change callback
settles, while requesting owner retirement separately to avoid a circular wait.

Restore compatibility checks before replication result application and the next
ordinary synchronisation. Retain observed feature requirements with the pending
work snapshot so that a shortened version-document list does not release a
blocked local database on restart. A dismissed Notice or a changed connection
does not establish that the affected local data has become interpretable.
An older local generation without feature declarations remains readable during
normal application and cleaned-remote recovery; remote migration remains the
responsibility of the replication admission check.

Garbage Collection V3 is a beta manual operation which begins with an ordinary
bidirectional synchronisation. That admission checks the remote feature
contract; no additional per-step GC checks are introduced. The separate
cleaned-remote recovery path checks the local version document before its
first Chunk-reference count because it does not start with that synchronisation.

Use the same Commonlib assessment at the CLI, Fast Fetch, and direct-access
boundaries. The Obsidian result processor is one consumer, not the only place
which determines compatibility. Keep unrelated Vaults and databases operational.

## Verification and documentation

Keep focused tests for settings defaults and imports, the Doctor condition
matrix, acceptance and dismissal, connection replacement, and absence of an
automatic Rebuild, Fetch, or restart for this rule.

Add deterministic runtime tests for feature-only changes, version documents
first and last in a batch, unknown-name presentation, duplicate notifications,
queued and waiting reflection, stale database callbacks, restart, checkpointed
but unapplied documents, and cancellation without a circular wait.

Before this implementation, the host processor was checked with a focused unit probe: a numeric
incompatibility requests retirement, but the processor still applies a note in
the same batch when its host remains ready. A same-version document with an
unknown feature does not request retirement. These observations motivated the
new checks.

Extend real Obsidian Hidden File Sync and Customisation Sync scenarios and the
CLI interoperability checks. Inspect raw CouchDB documents as well as restored
files. Exercise an active connection when another client changes the feature
requirements, and verify that previously accepted data survives the stop.
Pending-work restoration and recovery with a compatible client are separate
boundaries.

The local packed Commonlib 0.1.30 candidate passed Commonlib unit and boundary
tests and the LiveSync build, type checks, and unit tests. Real Obsidian 1.12.7
passed the Hidden File Sync, Customisation Sync, and encrypted CLI-to-Obsidian
scenarios. The dedicated active-connection scenario changed a generation 12
remote to generation 13 with an unknown feature whilst continuous replication
was running. The local control document arrived, the active Replicator retired,
a subsequent replication was refused, and an earlier accepted note stayed in
the Vault. The same real Obsidian scenario now shortens both control-document
feature lists and restarts the Vault. The saved observation remains associated
with the same physical database, and both OneShot and Continuous replication
are refused. Focused host tests cover both batch orders, pending-work snapshots,
stale callbacks, and the older local-generation case. Recovery after upgrading
to a future client that understands the unknown feature has not been exercised
in real Obsidian. The existing [readiness queue issue](https://github.com/vrtmrz/obsidian-livesync/issues/1200)
still affects when restored pending documents resume after the application
becomes ready; snapshot preservation alone does not resolve that issue.

Keep the primary-language settings and troubleshooting guides, the
database-compatibility ADR, and Unreleased notes aligned with this behaviour.
Keep the detailed shared protocol in Commonlib and link to it after publication;
do not maintain another copy of its wire schema here. Translations are a separate
change. Update tested-version evidence when the implementation and its
validation have been accepted.

Related application contracts: [Replicator architecture](replicator_architecture.md),
[Tweak compatibility](tweak_compatibility.md), and
[database compatibility](../adr/2026_07_release_notes_and_database_compatibility.md).
