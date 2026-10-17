---
date: 2026-10-17
commonlib-version: "0.1.42"
self-hosted-livesync-version: "1.0.37"
status: unreleased
---

# Unicode path identity

## Purpose and baseline

This design defines how Self-hosted LiveSync opts into Unicode NFC for normal
file Metadata document IDs, how hosts preserve the Vault's physical names, and
how existing databases move to the new identity. The accepted rationale is in
the [Unicode path identity ADR](../adr/2026_10_unicode_path_identity.md).
Commonlib's [consumer contract](https://github.com/vrtmrz/livesync-commonlib/blob/main/docs/unicode-path-identity.md)
defines the shared package boundary.

This records an unreleased change after Self-hosted LiveSync `1.0.37`, using the
published Commonlib `0.1.42` package as an exact dependency.

## Scope

| Area | Contract |
| --- | --- |
| Logical identity | Version `1` uses NFC for Metadata ID and path comparison keys. Existing case handling remains a separate rule. Missing and `0` retain legacy behaviour. |
| Stored paths and content | Keep the spelling in `Metadata.path` and existing physical Vault names. NFC does not change Chunk IDs or content. |
| Initial hosts and remote | Support CLI and Obsidian with CouchDB. |
| Other transports | Journal and P2P reject version `1`; Direct file access refuses a remote declaring the NFC feature. Other host adapters remain outside the support matrix. |
| Migration | Rebuild both databases from one complete authoritative Vault, then Fetch each remaining client. Do not rewrite IDs or merge histories in place. |

## Path identity contract

`pathNormalizationVersion` selects the logical path used by Commonlib's
`PathService` for normal-file Metadata IDs and path comparison keys:

| Value | Path identity |
| --- | --- |
| Missing or `0` | Preserve the legacy path and ID behaviour exactly. |
| `1` | Apply Unicode NFC to the logical path, then apply the existing case handling and ID derivation rules. |
| Any other value | Reject it; do not fall back to legacy mode. |

NFC changes only logical identity and comparison keys. It is not a physical
filename conversion, a rewrite of `Metadata.path`, or a Unicode compatibility
transformation such as NFKC. Existing case handling remains governed by
`handleFilenameCaseSensitive`; it is independent of NFC equivalence resolution
in the CLI. `idDerivationVersion` continues to select its separate
cryptographic ID construction. NFC path identity works with or without
encryption and does not change Chunk IDs or content.

The version is a required Tweak, even when encryption is disabled, represented
by `nfc-path-identity-v1` in the existing generation-13 database version
document's `used_features` list. The Setup URI includes
`pathNormalizationVersion`, decodes an absent value as `0`, and rejects
unsupported values. Sharing the setting communicates the target identity;
setup still requires an explicit Rebuild or Fetch choice.

Fast Fetch checkpoints include the path identity version. A checkpoint created
under legacy identity cannot be resumed under version `1`, or vice versa. This
reuses the existing checkpoint identity and does not add a separate recovery
store.

## Admission and database compatibility

Clients validate local and remote database identity before accepting ordinary
replication, including when configuration-mismatch warnings are disabled. The
checks cover both directions:

| Client setting | Database feature | Result |
| --- | --- | --- |
| Missing or `0` | No NFC feature | Continue with legacy identity. |
| `1` | NFC feature present | Continue with NFC identity. |
| `1` | Neither database has the feature or Metadata | A fresh database may declare the feature before its first Metadata mutation. |
| `1` | A database has Metadata without the feature | Reject ordinary writes; require Rebuild. |
| Missing or `0` | A local or remote database has the NFC feature | Reject; the database requires a version-`1` client. |

The feature is independent of encryption. Receiving an incompatible version
document records the incompatibility and stops the active synchronisation
session. This is a compatibility fence, not a rollback of operations already
admitted elsewhere; every device must be stopped before migration begins.

## Host path resolution and collision preflight

Commonlib owns logical ID derivation and the Rebuilder's preflight contract.
Each host maps that logical path to entries in its supported storage listing.

The CLI resolves existing files and directories using NFC comparison keys,
regardless of `handleFilenameCaseSensitive`. It carries the actual spelling
reported for each existing component through reads, writes, deletes, stat,
directory creation, and rename operations. If a path has missing components,
the CLI uses the actual existing parent and preserves the received spelling for
each new component. A scan enumerates each directory once and stats the raw
paths returned by that enumeration; it does not repeat canonical lookup for
each listed entry. No persistent index or recovery store is added.

If more than one entry resolves to the same logical comparison key after NFC
and the configured case rule at any component, including a parent directory,
the path is ambiguous. The CLI warns and refuses the operation; it must not
select a candidate based on directory enumeration order, merge the entries, or
rename them. The same rule applies during Rebuild preflight.

Obsidian resolution remains within its `TFile` and Vault API boundary. Its
collision preflight checks paths exposed through those APIs; it does not walk
the physical Vault independently and cannot promise to detect raw filesystem
aliases hidden by Obsidian's index. Other host adapters remain outside the
version-`1` support matrix until their path resolution and ambiguity handling
are implemented and verified within their own supported listings.

Before resetting either database, Rebuild checks the supported storage
listing and local Metadata for paths which would resolve to the same identity
under NFC and the configured case rule. When a local database is not open,
preflight checks the storage paths returned by the host listing. If multiple
candidate files or Metadata documents collide, or a parent component is
ambiguous, the operation stops before local or remote mutation. It does not
choose a winner, merge revision histories, or rename a Vault file. The user
must resolve the ambiguous names or exclude one file from the synchronisation
scope, then retry the reconstruction. This check is bounded by the host's
listing contract and does not imply that every raw physical alias is visible.

## Reconstruction and client operations

Mode changes are never applied by an ordinary Metadata write. In Obsidian, the
Advanced page offers **Legacy path identity** (`0`) and **Unicode NFC path
identity** (`1`) for CouchDB. A changed `pathNormalizationVersion` remains
pending through ordinary settings saves, the settings-only Apply fallback, and
reload. It becomes active only after the existing Rebuild or Fetch operation
has been successfully reserved; cancellation or failed reservation leaves it
pending. A `remoteOnly` operation cannot apply a pending identity change, and
the settings-only fallback is not offered.

The [user migration procedure](../recovery.md#migrate-to-unicode-nfc-path-identity)
owns the operational sequence: updated and stopped clients, a complete backed-up
authoritative Vault, source Rebuild, then Fetch on each remaining client. The
source operation reconstructs both databases; a receiving client's Fetch
replaces only its local database. The [CLI guide](../../src/apps/cli/README.md)
provides the equivalent `rebuild` and `fetch` commands.

The CLI checks `--force` before core start-up so an omitted confirmation cannot
trigger database access or destructive preparation. Neither `--force` nor a
headless default choice overrides an NFC collision, a feature mismatch, or a
preflight failure. If a required setup decision cannot be made in a headless
CLI invocation, the command must fail with a clear remediation message rather
than report success after cancellation.

`--write-settings` retains the Rebuilder's selected local database name and
lasting settings changes for subsequent invocations. Without this option, the
existing CLI policy leaves the settings file unchanged, so a later command can
reopen the previously selected database.

## State which follows the selected identity

The path identity is also used by two existing resume mechanisms:

- **File-reflection provenance:** the existing device-local provenance storage
  interface remains an exact-key store. The private
  `ServiceFileHandlerBase.getProvenancePath()` method canonicalises provenance
  keys with NFC in mode `1` for reads, writes, deletes, raw snapshot lookup,
  and untracked revision recording. Mode `0` retains the old keys. Rebuild and
  Fetch use the existing local-state reconstruction and replacement lifecycle;
  no NFC-specific persistent field or in-place key migration is introduced.
  Commonlib 0.1.42 separately adds content hashes to the same records. The
  [file-provenance contract](../specs_conflict_resolution.md#device-local-file-provenance)
  defines that content evidence; changing a path key neither changes file
  bytes nor supplies missing revision ancestry.
- **Fast Fetch checkpoints:** the path version participates in checkpoint
  identity so an interrupted transfer cannot resume using a different
  path-to-ID rule. Existing checkpoint persistence and retry handling remain
  in control.

These rules keep a physical NFD filename addressable when an NFC-equivalent
Metadata path arrives, while using one canonical identity for subsequent
updates and deletions.

## Compatibility matrix

| Client and remote | Version `0` | Version `1` |
| --- | --- | --- |
| CLI with CouchDB | Supported with legacy identity. | Supported with NFC path resolution. |
| Obsidian with CouchDB | Supported with legacy identity. | Supported with NFC path resolution. |
| Journal or P2P | Existing behaviour. | Rejected. |
| Direct file access | Existing behaviour. | Refuses a remote requiring `nfc-path-identity-v1`. |
| Other host adapters, including WebApp | Existing behaviour, subject to their existing support. | Outside the initial support matrix until physical-path handling is verified. |
| Older client without this feature | Can use a legacy database. | Cannot join a database declaring `nfc-path-identity-v1`. |

## Verification contract and limits

The implementation acceptance matrix covers:

- unchanged legacy IDs for missing and explicit version `0`, plus matching
  ASCII IDs in both modes;
- identical normal-file Metadata IDs for NFC and NFD spellings in version `1`,
  with and without path obfuscation, and with the existing case rule applied;
- Metadata creation, update, deletion, and file-reflection provenance using the
  same canonical identity without renaming the physical file;
- CLI reads, writes, deletes, stat, directory creation, and rename through the
  actual spelling of existing files and parents; preservation of the received
  spelling for new components; and resolution independent of the case setting;
- refusal to write when an existing legacy database has Metadata, refusal of
  version-`0` clients against an NFC database, and enforcement when ordinary
  mismatch warnings are disabled;
- URI round trips, checkpoint invalidation across path versions, and transport
  rejection for Journal, P2P, and Direct file access;
- refusal for ambiguous file or parent-directory candidates before local or
  remote reset, preserving both databases on rejection, within the paths
  returned by each host's supported listing; and
- CLI `rebuild` and `fetch` command dispatch, pre-start `--force` enforcement,
  and end-to-end creation, update, and deletion through CouchDB between CLI and
  Obsidian.

Focused unit and package checks do not substitute for the real CouchDB and
Obsidian round trip using the exact published Commonlib artefact. Obsidian checks
are limited to paths exposed through its `TFile` and Vault APIs; they do not
establish detection of physical aliases hidden by the Obsidian index. No result
for raw physical filesystem aliases outside a host's supported listing is
claimed.

Local validation on Linux with real Obsidian `1.12.7` and the published
Commonlib `0.1.42` package passed after the CLI path resolution, case-aware
collision scan, and pending-setting changes. It covered:

- NFC identity with unencrypted Metadata;
- NFC identity with E2EE and Path Obfuscation;
- two legacy CLI databases migrated through `rebuild` and `fetch`, followed by
  the encrypted Obsidian round trip; and
- the existing encrypted ASCII scenario in legacy mode.

In those NFC scenarios, an NFD directory and mixed-form filename were retained
while checking content, Metadata creation time, remote updates, absence of an
NFC duplicate, and remote deletion through the polling CLI daemon. The `mirror`
command retains tombstoned local files by default; its update behaviour was
tested separately from daemon deletion reflection.

## Non-goals

This design does not:

- change Chunk IDs, E2EE, Properties encryption, or the Metadata and Chunk
  document formats;
- convert or rename existing physical files;
- migrate remote document IDs or revision histories in place;
- choose among ambiguous NFC-equivalent files or parents, or merge their
  content;
- change the default away from legacy path identity;
- enable version `1` for Journal, P2P, Direct file access, WebApp, or an
  unverified host adapter; or
- claim native iOS or macOS filesystem compatibility.

## References

- [Unicode path identity ADR](../adr/2026_10_unicode_path_identity.md)
- [Setting details](../settings.md#unicode-path-identity)
- [User migration procedure](../recovery.md#migrate-to-unicode-nfc-path-identity)
- [Commonlib Unicode path identity contract](https://github.com/vrtmrz/livesync-commonlib/blob/main/docs/unicode-path-identity.md)
- [Metadata and Chunks glossary](../glossary.md#user-facing-and-operational-terms)
