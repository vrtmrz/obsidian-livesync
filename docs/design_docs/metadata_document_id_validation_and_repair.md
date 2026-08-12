# Normal-file Metadata Document ID Validation and Repair

## Status

Accepted

## Problem and scope

A normal-file Metadata document is addressed by an ID derived from its recorded
Vault-relative path. Historical data can contain a readable Metadata document
whose actual local database ID no longer matches that derivation. An ordinary
path-based read then looks up a different ID. It may reach a separate,
consistently addressed Metadata document, or it may find no document at all;
it cannot reach the malformed document which the Offline Scanner enumerated.

The mismatch can repeatedly produce failed reflection, and an offline-deletion
decision can be made before that failure. The scanner must therefore recognise
the mismatch before any file reflection, database deletion, expired-history
cleanup, or last-seen update.

This design covers ordinary Vault files. Hidden File Sync, Customisation Sync,
and the obsolete plug-in storage namespace retain their feature-specific
processing. A disagreement between the document-ID namespace and recorded-path
namespace is reported, but is not repaired by this workflow.

## Evidence and cause boundary

The reported data included readable paths which could be enumerated from
Metadata but could not be fetched again through the path-derived lookup. The
Vault also had a history of case changes in folder names. This is consistent
with an ID/path mismatch, but it does not prove whether a historical rename,
interrupted migration, or earlier path-setting change created it.

The repair workflow must not infer that the current path is authoritative merely
because it is readable. It is available only when the local evidence is
unambiguous and current.

## Identity invariant

For normal-file Metadata:

    actualDocumentId === path2id(declaredPath)

The active path service owns the derivation. In particular,
handleFilenameCaseSensitive, usePathObfuscation, and the path-obfuscation
passphrase can change the expected ID. The E2EE Security Seed and Chunk settings
do not directly participate in this ID.

Inspection and repair use the current local path service. They do not query the
remote or decide whether this device's settings should become authoritative.
Commonlib recalculates the expected ID during its pre-mutation inspection, so a
local ID-derivation setting change makes an earlier approval stale. An
intentional whole-database change to ID-derivation settings requires the
established rebuild workflow, not this one-entry repair.

## Offline Scanner decision

The Offline Scanner validates each decoded Metadata document while its actual ID
is still available. It does this before target-file policy and path-keyed pair
construction.

- Consistent normal-file Metadata continues through the existing scan.
- Consistent special-namespace Metadata remains owned by its feature.
- An ID/path or namespace mismatch is left unchanged and does not enter pair
  processing.
- If consistent, selected Metadata represents the same case-normalised path,
  that Metadata and its storage file continue through the established
  path-based scan. A stale enumerated document must not suppress this flow.
- If no consistent, selected Metadata represents that logical path, its storage
  entry is also withheld. No storage write, database deletion, or last-seen
  update is performed for that withheld path.
- Expired logical deletion history is not hard-tombstoned while its identity is
  inconsistent.

The ordinary scan still returns its established Boolean execution result. A
recognised mismatch is a quarantined input, not a new public scan result and not
a Fast Setup or CLI policy. Detailed inspection is deliberately separate.

## Inspection decision

inspectMetadataDocumentIdentities is read-only and enumerates the local database
by actual document ID. This is necessary because a path-first Inspector cannot
discover the malformed source.

The existing **Inspect conflicts and file/database differences** interface shows
one card for each mismatch. It excludes that card's path from ordinary
path-based repair only when no consistently addressed Metadata document can be
resolved for the same logical path. A stale entry does not hide the normal
inspection of a resolvable entry. Multiple affected files are presented
separately; there is no batch repair.

A one-entry repair is offered only when all of these checks pass:

- the mismatch is within the normal-file namespace;
- the source is the current live revision and has no conflicts;
- the recorded path is valid and selected by current synchronisation policy;
- one case-normalised path maps to one source under the active filename setting;
- only one malformed source expects the target ID; and
- the target ID is absent, or contains an exact structural copy left by an
  earlier attempt.

An exact structural copy has the same path, timestamps, size, type, Chunk
references, Eden data, and logical-deletion state. Inspection does not fetch
Chunk content or query the remote. Missing content remains the responsibility
of the existing file and Chunk repair tools.

## Repair decision

The user explicitly confirms one actual ID, expected ID, and source revision.
Commonlib then:

1. acquires the existing ordered document locks for the source and target IDs;
2. reruns the complete inspection and rejects stale or unsafe input;
3. reads the exact approved source revision;
4. removes the path from the Offline Scanner's durable last-seen map;
5. writes the expected target ID when it is absent;
6. reads the target back and verifies the exact structural copy;
7. hard-tombstones the source using the approved source revision; and
8. returns control to LiveSync, which requests an ordinary Vault scan.

The repair result and the follow-up scan result remain separate. If the scan is
suspended, returns false, or raises an error after the source has been removed,
LiveSync reports that the identity repair completed and directs the operator to
run the ordinary scan separately. It does not describe the completed mutation
as a failed or rolled-back repair.

The target is always verified before the source is removed. If target creation
fails, the source remains. If source removal fails, the exact target remains and
the same one-entry action can finish the operation after a new inspection. This
retry property is an implementation safety guarantee, not a separate public
repair mode.

The target receives new CouchDB revision ancestry because ancestry cannot move
between document IDs. Users are told to back up the device, pause editing and
synchronisation on other devices, allow the change to replicate, and inspect
again.

## Case handling

The active handleFilenameCaseSensitive setting defines whether path claims are
folded before ambiguity is assessed. When case-insensitive handling is active,
a consistently addressed entry may continue through the existing path-based
flow even if a stale case variant is also reported. The stale entry is not
automatically selected or removed unless the one-entry repair preconditions
hold. When case-sensitive handling is active, intentional variants remain
distinct.

This workflow does not rename Vault files or folders, infer a preferred folder
name from one device, or coordinate a repair across devices. The repair changes
one local database and relies on ordinary replication afterwards. Other devices
must remain paused until that result has replicated and a new inspection is
clean.

For widespread cross-device naming differences, the operator must choose an
authoritative Vault, stop every participating device, correct its storage names
outside Obsidian, rebuild the central remote from that Vault, and reset the
other devices from the verified remote. During Fast Setup on an empty Vault,
there are no storage names to correct: the scanner reflects every consistently
addressable Metadata entry and reports only the references which remain
unresolved.

## Non-goals

This change does not:

- repair several entries automatically or in a batch;
- choose between competing case variants;
- rename storage files or folders;
- coordinate a distributed repair across devices;
- migrate an entire database after path-obfuscation or case-setting changes;
- repair special-namespace Metadata;
- reconstruct unavailable Chunk content;
- query or modify the remote directly; or
- change Fast Setup, daemon, or CLI completion policy.

## Verification

Focused Commonlib tests cover early quarantine, continued processing of a
resolvable same-path entry, expired logical-deletion retention, namespace
routing, read-only actual-ID inspection, repair preconditions, target-first
ordering, stale approval, exact-target retry, source preservation on failure,
and last-seen clearing. LiveSync tests cover selective presentation-path
withholding, separate confirmation, cancellation, and the ordinary scan request
after a completed repair.
