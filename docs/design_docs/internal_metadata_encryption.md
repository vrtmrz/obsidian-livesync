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

## Admission and received version documents

The remote version document is the source of feature requirements. Commonlib
checks it before replication, Fast Fetch, and direct access. The milestone keeps
the existing Tweak comparison and Rebuild lock. An accepted writer declares the
feature before using it, including the writer admitted to a locked rebuilt
remote; an unaccepted device remains blocked by that lock.

Retain the existing received-version path through `parseSynchroniseResult`,
`enqueueAll`, and `processIfNonDocumentChange`. Replace its numeric comparison
with the shared assessment so unknown names at the same generation are also
reported. Known features, reordered lists, and ordinary revision updates do not
retire the connection. Unsupported or malformed control documents request
retirement through the existing Replicator owner and display the reason.
The callback must not await retirement of the operation which delivered it.

This is an admission check and a best-effort stop for exceptional changes during
an active connection. It does not fence every queued file application, roll back
accepted writes, or guarantee an atomic change across live devices. Feature
changes are an infrequent administrative operation: update all devices first,
then enable the preference and use the recommended manual Rebuild. Rebuild
locks the remote using the existing workflow; changing this preference alone
does not lock it. The action to proceed without rebuilding explicitly reminds
the person to update every other device, including currently connected devices.

## Persistence and recovery boundaries

Do not retain a second feature list, highest generation, or rejection flag in
KV storage. Do not add compatibility checks to pending-work snapshot recovery
or make that recovery a new prerequisite for application readiness. Preserve
the existing queue and startup behaviour. A later attempt checks the current
remote declaration, including after restart. Declared features remain on the
remote when the write preference is disabled because older data can still use
them; manually shortening that declaration is not a supported migration.

After updating clients, use normal reconnection and the existing Hatch
inspection or Fetch workflow if reconciliation is needed. This feature does not
repair unrelated KV inconsistencies or the existing readiness queue behaviour.

Garbage Collection V3 is a beta manual operation which begins with an ordinary
bidirectional synchronisation. That admission checks the remote feature
contract; no additional per-step GC checks are introduced. The separate
cleaned-remote recovery path checks the local version document before its
first Chunk-reference count because it does not start with that synchronisation.

Use the same Commonlib assessment at the CLI, Fast Fetch, and direct-access
boundaries. The Obsidian result processor is one consumer, not the only place
which determines compatibility. Keep unrelated Vaults and databases operational.
Fast Fetch checks the remote declaration before opening or resetting the local
database, both for a fresh Fetch and for checkpoint resumption.

## Verification and documentation

Keep focused tests for settings defaults and imports, the Doctor condition
matrix, acceptance and dismissal, connection replacement, and absence of an
automatic Rebuild, Fetch, or restart for this rule.

Exercise the Doctor choices in real Obsidian as well: decline the consultation,
skip the recommendation with a reminder, dismiss the current Doctor version,
and reopen it through **Run Doctor** to accept. Restart the same Vault and
profile between choices to verify persistence and whether the consultation
reappears. Preserve the local database and existing remote documents throughout
acceptance, then verify that subsequent writes encrypt internal Metadata.

Keep unit tests for known and unknown feature notifications, generic identifier
presentation, retirement without a circular wait, and the unchanged snapshot
behaviour after KV failure or obsolete snapshot fields. The previous batch
fences, physical-database tracking, and persistent rejection tests are outside
this design; they must not imply an atomic live migration guarantee.

Use real Obsidian Hidden File Sync and Customisation Sync scenarios to inspect
raw CouchDB Metadata and restore content in another Vault. Check the admitted
writer on a locked remote, unknown-feature rejection before and during
replication, and remote-based rejection after restart. Retain the encrypted
CLI-to-Obsidian interoperability scenario. A future client upgrade that adds
support for an unknown feature is a separate validation boundary.

Also exercise enabling the preference through the settings UI without Rebuild:
retain unchanged plaintext Metadata, encrypt rewritten entries with stable IDs,
reject a second device's mismatched preference, and restore both representations
after alignment. With the preference subsequently OFF, verify that Fast Fetch
still decodes encrypted Metadata and preserves the remote feature declaration.

Keep the primary-language settings and troubleshooting guides, the
database-compatibility ADR, and Unreleased notes aligned with this behaviour.
Keep the detailed shared protocol in Commonlib and link to it after publication;
do not maintain another copy of its wire schema here. Translations are a separate
change. Update tested-version evidence when the implementation and its
validation have been accepted.

Related application contracts: [Replicator architecture](replicator_architecture.md),
[Tweak compatibility](tweak_compatibility.md), and
[database compatibility](../adr/2026_07_release_notes_and_database_compatibility.md).
