---
date: 2026-10-19
commonlib-version: "0.1.43"
self-hosted-livesync-version: "1.0.38"
status: released
---

# Unicode path identity

## Purpose and baseline

This design defines how Self-hosted LiveSync opts into Unicode NFC for normal
file Metadata document IDs, how hosts preserve the Vault's physical names, and
how existing databases move to the new identity. The accepted rationale is in
the [Unicode path identity ADR](../adr/2026_10_unicode_path_identity.md).
Commonlib's [consumer contract](https://github.com/vrtmrz/livesync-commonlib/blob/main/docs/unicode-path-identity.md)
defines the shared package boundary.

NFC identity shipped in Self-hosted LiveSync `1.0.38` with Commonlib `0.1.42`.
Conflict-aware deletion handling during reconstruction was added separately
and is included in current Commonlib `0.2.2`, used by Self-hosted LiveSync
`1.0.42`. This later handling is distinct from the initial NFC identity
release.

Commonlib `0.3.0` publishes the Journal and P2P path-identity protocol
extension. The matching Self-hosted LiveSync CLI and Obsidian host adoption,
including moving the setting to General Settings and defaulting new
synchronisation environments to NFC, is included in Self-hosted LiveSync
`1.0.45` with Commonlib `0.3.2`. The development candidate was tracked by [pull request #1309](https://github.com/vrtmrz/obsidian-livesync/pull/1309);
the original dates and reviewed versions above remain the historical baseline.

<a id="unreleased-shared-storage-boundary"></a>

## Shared storage boundary

Commonlib `0.3.1` publishes the shared storage-path contract, including
its Unicode resolver and typed physical-I/O ports. The LiveSync CLI adopts
the shared resolver and typed physical-I/O ports, while Obsidian adopts
shared namespace and comparison helpers and retains its Vault APIs and
existing alias-guard policy. These host changes are included in Self-hosted
LiveSync `1.0.45` with Commonlib `0.3.2`. Each NFC scan retains one
comparison-policy snapshot; directory and permission errors propagate
instead of producing a successful partial scan. The
[developer guide](../../devs.md#file-path-handling) links the Commonlib design
and ADR.

## Scope

| Area | Contract |
| --- | --- |
| Logical identity | Version `1` uses NFC for Metadata ID and path comparison keys. Existing case handling remains a separate rule. Missing and `0` retain legacy behaviour. |
| Stored paths and content | Keep the spelling in `Metadata.path` and existing physical Vault names. NFC does not change Chunk IDs or content. |
| Maintained hosts and transports | CLI and Obsidian with CouchDB were first released in Self-hosted LiveSync `1.0.38`; their Journal and P2P host support is included in `1.0.45` with Commonlib `0.3.2`. See the support matrix below. |
| Other consumers | Direct-file access and other host adapters are covered separately below; shared path primitives alone do not enable NFC in an application. |
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

## Initial settings and existing environments

Self-hosted LiveSync `1.0.45` uses version `1` for newly generated CLI settings
and Obsidian manual onboarding. Stored settings and old Setup URIs with no
path version retain `0`. Commonlib's shared settings defaults remain `0`, so this
host policy does not extend to WebApp or WebPeer. An absent settings file alone
does not establish that an existing local database is new.

Before saving initial manual CouchDB or Object Storage setup, the host reads
the remote declaration through its owned connection resource. A configured
remote supplies `0` or `1`; only a confirmed empty remote retains the new
settings' selected version. Read failures and unsupported or contradictory
declarations stop setup without saving a guessed value. The CLI makes the same
read before opening the local database for an unconfigured client's first
explicit Fetch. Ordinary configured startup and source Rebuild do not adopt a
remote's mode automatically.

CouchDB inspection reads the version document without preparing encryption or
creating a database. Without a version document, a non-empty database remains
legacy. Journal inspection reads its existing milestone ranges and preferred
Tweaks without registering a node, preparing a Security Seed, or resetting a
checkpoint. P2P Setup URIs carry the selected version. Manual P2P configuration
requires the owner to match the source; the signalling probe does not establish
the remote database's identity, and replication still rejects a mismatch.

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

For full Rebuild, Standard Fetch, and Fast Fetch, which replace the local
database, the Metadata enumeration requests conflict information. It excludes
`deleted: true` documents only when they have no unresolved conflict leaves.
A deleted winner with any unresolved conflict remains a collision candidate,
including when the other leaves are also logically deleted. Remote-only
Rebuild retains logically deleted Metadata and requires stored IDs to match
the selected identity. Fully tombstoned documents are already absent from
ordinary enumeration; a still non-deleted local copy remains subject to the
check until a remote deletion has been replicated.

## Reconstruction and client operations

Mode changes are never applied by an ordinary Metadata write. In Obsidian, the
General Settings → **File identity** offers **Legacy path identity** (`0`)
and **Unicode NFC path identity** (`1`) independently of the selected transport. A changed `pathNormalizationVersion` remains
pending through ordinary settings saves, the settings-only Apply fallback, and
reload. It becomes active only after the existing Rebuild or Fetch operation
has been successfully reserved; cancellation or failed reservation leaves it
pending. A `remoteOnly` operation cannot apply a pending identity change, and
the settings-only fallback is not offered.

The [user migration procedure](../recovery.md#migrate-to-unicode-nfc-path-identity)
owns the operational sequence: updated and stopped clients, a complete backed-up
authoritative Vault, source Rebuild, then Fetch on each remaining client. The
source operation reconstructs both databases for CouchDB and Journal. With
P2P, it reconstructs only the source database. A receiving client's Fetch
replaces only its local database. The [CLI guide](../../src/apps/cli/README.md)
provides the equivalent `rebuild` and `fetch` commands.

The CLI checks `--force` before core start-up so an omitted confirmation cannot
trigger database access or destructive preparation. Neither `--force` nor a
headless default choice overrides an NFC collision, a feature mismatch, or a
preflight failure. If a required setup decision cannot be made in a headless
CLI invocation, the command must fail with a clear remediation message rather
than report success after cancellation.

The CLI correction for #1304 is included in Self-hosted LiveSync `1.0.44` and
always retains the Rebuilder's selected local database suffix after successful
`fetch` or `rebuild`. `--write-settings`
still controls other lasting settings changes. Earlier versions required that
option to retain the database selection; omitting it could reopen the previous
database on the next invocation. The examples retain the option for compatibility.

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

| Host or API | Published baseline | Current support or host-specific status |
| --- | --- | --- |
| CLI and Obsidian with CouchDB | NFC identity is supported from Self-hosted LiveSync `1.0.38` with Commonlib `0.1.42`. | Commonlib `0.3.1` publishes the shared storage-path contract; LiveSync's CLI resolver and Obsidian namespace and comparison-helper adoption are included in Self-hosted LiveSync `1.0.45` with Commonlib `0.3.2`. |
| CLI and Obsidian with Journal | Commonlib `0.3.0` publishes the NFC protocol support. | Matching host adoption is included in Self-hosted LiveSync `1.0.45` with Commonlib `0.3.2`. Update and migrate every client before using version `1`. |
| CLI and Obsidian with P2P | Commonlib `0.3.0` publishes the NFC protocol support. | Matching host adoption is included in Self-hosted LiveSync `1.0.45` with Commonlib `0.3.2`. All peers must use the same path version; P2P warns and continues for ordinary representation or case differences. |
| Bridge | The published baseline uses Legacy version `0`. | The Bridge integration is an unreleased candidate with explicit per-peer opt-in to version `1`; every peer in a group must use the same version. Its ordinary case mismatch check remains enabled unless the Bridge-wide `disableCheckingConfigMismatch: true` override disables that case check. The override does not bypass a path-version mismatch. |
| `DirectFileManipulator` | Commonlib `0.3.1` accepts explicit `pathNormalizationVersion` values `0` or `1`, defaults to Legacy (`0`), and rejects a populated database in the opposite mode. | This admission setting does not resolve physical paths; callers own physical path resolution and migration. |
| WebApp | Legacy version `0` only. | WebApp remains Legacy-only and rejects an explicit version `1` at startup. The browser resolver primitive does not enable NFC in WebApp. |
| WebPeer | A vaultless P2P utility, not a filesystem host. | No NFC filesystem support is implied by its P2P role. |
| Older client without this feature | Can use a legacy database. | Cannot join a database declaring `nfc-path-identity-v1`. |

## Journal and P2P extension

The transport moves the Metadata IDs already generated in the local database;
it does not derive a second remote ID. Journal uses its existing compatibility
range with NFC value `4`, plus a required path-version comparison. A legacy
client with ordinary version checking cannot join the rebuilt Journal. The
explicit version override in older clients remains outside this guarantee.
Journal refuses to initialise NFC compatibility when journal objects exist
without their milestone.

Journal shares one read-only identity assessment across ordinary admission,
Fetch before local reset, and ordinary milestone updates. It checks stored
node ranges even when a Rebuild lock has retired the previous accepted nodes.
Rebuild locks the existing milestone for its source node while retaining an
existing compatibility range, and declares the replacement identity only after
the remote journals have
been deleted. If the milestone is missing, the pre-reset lock does not create
one over the existing journals. A failed or interrupted reset therefore keeps
the old identity or the missing declaration.

P2P compares the effective path version through its existing Tweak exchange,
checks local database identity, and reads the peer version document before
replication. Fresh control-only databases can declare the existing NFC feature.
Every participating peer must be updated and migrated; this is not a new
authentication protocol for already deployed clients.

The existing Rebuild and Fetch paths own migration and state reset. Journal
reconstructs the local database and remote objects; P2P Rebuild reconstructs
only the source database. Other devices Fetch the source. Local reset clears
Journal KV checkpoints, while P2P uses its existing source mark and target
checkpoint. No new migration store, checkpoint format, or persistent admission
state is added. An explicit Journal bucket reset also clears the existing
transfer checkpoint when the bucket is already empty, so a remote-only Rebuild
resends the complete local database. P2P retains its existing peer selection
during Fetch.

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
- URI round trips, checkpoint invalidation across path versions, and
  explicit Legacy/NFC admission by `DirectFileManipulator` in Commonlib `0.3.1`,
  including rejection of a populated database in the opposite mode. Journal and
  P2P protocol support is published in Commonlib `0.3.0`; matching CLI and
  Obsidian host adoption is included in Self-hosted LiveSync `1.0.45` with
  Commonlib `0.3.2`;
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

The published Commonlib `0.1.43` package also passed plain and encrypted NFC
migration with obsolete logical deletions, plus the legacy encrypted ASCII
scenario, on Linux with Obsidian `1.12.7` and CouchDB `3.5.0`. Both migration
variants checked CLI Rebuild, second-client Standard Fetch, and real Obsidian
Streaming Fast Fetch. Fast Fetch removed the obsolete Metadata and retained
the current NFC document, its active state, and its stored path. The existing
content, creation-time, physical-name, update, and deletion checks also passed.


<a id="unreleased-journal-and-p2p-validation"></a>

### Journal and P2P validation evidence

The host adoption is included in Self-hosted LiveSync `1.0.45` with Commonlib
`0.3.2`. Initial checks were run on Linux with a locally packed Commonlib
`0.2.3` candidate and real Obsidian `1.12.7`. They covered:

- real S3-compatible Journal transfer with and without E2EE and Path
  Obfuscation, including restart, logical rename and deletion, both conflict
  leaves and their revision ancestry, and a full resend after bucket reset;
- real Obsidian and CLI Journal round trips with plain IDs and independent
  encrypted IDs: Standard Fetch, identical Metadata IDs and Chunk content,
  retention of a pre-existing NFD physical name, edits after CLI process
  restart, and deletion reflected back into Obsidian;
- real CLI P2P peers in legacy mode and NFC mode, with and without encryption
  in NFC mode: canonical path reads, incompatible-peer refusal, reverse edits
  after restart, retained original revision content, logical rename, and
  deletion. Existing automatic-host, adapter-replacement, and explicit
  disconnect scenarios also passed; and
- two real Obsidian `1.12.7` processes in an isolated Compose project, with NFC
  identity in plain and E2EE/Path Obfuscation modes using an independent ID key:
  initial Fetch, identical Metadata IDs and Chunk-backed content, reverse edits,
  retained original revision bodies, a full application restart and subsequent
  transfer, and explicit path-version refusal after ordinary peer permission.
  The refused peer retained its sentinel ID, revision, and content and imported
  no source Metadata or file. These cases passed on 2026-11-02 with the updated
  locally packed candidate after integrating the current main branches.

The Journal migration scenarios also start with existing legacy CLI databases.
The source Rebuild changes its Metadata ID and declares compatibility range
`4`. A receiving client's legacy Fetch is refused while preserving its local
Metadata ID and revision and the remote milestone. After selecting NFC, its
Fetch converges to the source ID and content while preserving the NFD physical
path. Both plain and independently encrypted ID scenarios passed.

On 2026-11-02, the exact published Commonlib `0.3.0` package passed the
consumer source checks, unit tests, and plug-in, CLI, WebApp, and WebPeer builds.
The real Obsidian P2P cases above were repeated successfully with that package.
Real Obsidian and CLI Journal round trips and the legacy-to-NFC migration were
also repeated with plain IDs and independently encrypted IDs, retaining the
physical NFD names and verifying edits after restart and deletion propagation.
The CLI Compose P2P suite also passed with the published package, including
legacy and NFC identity, plain and encrypted NFC transfer, logical rename and
deletion, automatic hosting, adapter replacement, and relay disconnection.
Additional real Obsidian cases with the published package passed legacy-to-NFC
P2P migration with plain IDs and independently encrypted IDs. They seed legacy
NFD Metadata IDs using real Chunks, since Obsidian's file cache normalises
names. The checks covered source Rebuild and restart, Standard Fetch on the
receiving device, removal of obsolete active IDs, exact content, and retention
of physical NFD names. Both cases also passed transfer of a Unicode note,
logical rename with matching new IDs, and deletion after restart. An
incompatible P2P Fetch reset the local database before a peer was selected.
Its physical note retained its exact bytes, and a Fetch with matching settings
completed recovery. This check does not establish preservation of the old
database's revision history.

Real Obsidian Journal cases also passed remote-only Rebuild after deleting
their isolated Object Storage prefix while leaving the source database and
populated transfer checkpoint intact. With both plain IDs and independently
encrypted IDs, a fresh receiving database and its subsequent restart retained
the exact bodies of both conflict leaves, Chunk references, revision IDs, and
each leaf's `_revisions`. The source retained the readable body of its common
ancestor. Fresh receivers retained the ancestor ID without its historical
body; ancestry IDs alone do not establish that an older body is readable. The
[conflict policy](../specs_conflict_resolution.md#file-saving-and-reflection-guarantees)
continues to require an available shared base for conservative automatic merge.

The settings, first-join identity inspection, legacy Setup URI defaults, and
initial CLI Fetch persistence are also covered by unit tests. The additional
migration cases call the running plug-in's production Rebuild and Fetch
methods with real peer selection; reservation through the settings dialogue
has separate coverage.
These checks do not extend NFC support to other hosts or establish native iOS
or macOS filesystem behaviour.

## Non-goals

This design does not:

- change Chunk IDs, E2EE, Properties encryption, or the Metadata and Chunk
  document formats;
- convert or rename existing physical files;
- migrate remote document IDs or revision histories in place;
- choose among ambiguous NFC-equivalent files or parents, or merge their
  content;
- automatically change existing settings or database identity;
- automatically enable version `1` for WebApp or an unverified host adapter;
  or
- claim native iOS or macOS filesystem compatibility.

## References

- [Unicode path identity ADR](../adr/2026_10_unicode_path_identity.md)
- [Setting details](../settings.md#unicode-path-identity)
- [User migration procedure](../recovery.md#migrate-to-unicode-nfc-path-identity)
- [Commonlib Unicode path identity contract](https://github.com/vrtmrz/livesync-commonlib/blob/main/docs/unicode-path-identity.md)
- [Metadata and Chunks glossary](../glossary.md#user-facing-and-operational-terms)
