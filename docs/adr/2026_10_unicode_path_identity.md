---
date: 2026-10-17
commonlib-version: "0.1.42"
self-hosted-livesync-version: "1.0.37"
status: unreleased
---

# Architectural Decision Record: Unicode Path Identity for CouchDB

## Status

Accepted on 2026-10-17. The feature remains unreleased. Local validation
evidence and platform limits are recorded in the design document.

## Context

Self-hosted LiveSync derives normal-file Metadata document IDs from Vault paths.
Unicode permits visually identical text to use different code-point sequences.
For example, `é` can be represented as one precomposed character or as `e`
followed by a combining acute accent. Filesystems and applications can expose
these forms differently. Without a shared canonical form, two clients can
derive different document IDs for the same logical path, or fail to resolve an
existing document when another client reports an equivalent spelling.

Changing only a lookup performed when receiving a document is insufficient.
New documents, edits, deletions, local provenance, and resumable Fetch
checkpoints must all use the same path identity. Applying the change to a
populated database in place would
also leave old document IDs and revision histories behind. Distinct files or
Metadata documents can collapse to one identity under NFC, so automatic
selection or merging could lose user data.

The Metadata path and file content have separate roles: Metadata stores file
properties and references to Chunks, while Chunks store the content. A path
identity change must not require physical files to be renamed or content to be
rewritten in Metadata.

## Decision

Add the opt-in `pathNormalizationVersion` setting. An absent value and `0`
retain the existing path-to-ID behaviour. Version `1` applies Unicode
Normalization Form C (NFC) to the logical path used for Metadata IDs and path
comparison keys. Existing case handling remains an independent rule; CLI path
resolution uses NFC equivalence regardless of the `handleFilenameCaseSensitive`
setting. NFC changes logical identity only: it does not rewrite the stored
`Metadata.path`, rename a physical file, or change Chunk IDs or content. It is
independent of `idDerivationVersion` and does not require encryption.

When the CLI resolves a path, it uses the actual spelling of each existing
file and directory. A missing component is created under the actual resolved
parent using the spelling received for that component. Obsidian resolves paths
through its `TFile` and Vault APIs. Its collision checks are limited to the
paths those APIs expose and do not promise to find raw physical aliases hidden
by the Obsidian index.

The initial support boundary is CLI and Obsidian clients using CouchDB.
Journal and P2P reject version `1`; Direct file access refuses a remote which
declares the NFC feature. Other host adapters are not supported for version `1`
until they provide equivalent path resolution and ambiguity handling within
their supported storage listing.

Version `1` is represented by the required `nfc-path-identity-v1` feature in
the existing generation-13 database version document. Every client must agree
on the path identity before it can write Metadata. A mode `0` client cannot
join a database requiring this feature. An existing database without the
feature cannot acquire it through an ordinary Metadata write while it already
contains Metadata. These admission checks remain active when ordinary
configuration-mismatch warnings are disabled.

`pathNormalizationVersion` is a required Tweak even when encryption is
disabled. It does not replace or modify `idDerivationVersion`.

The supported migration is reconstruction, not an in-place ID rewrite:

1. Update every participating client and stop synchronisation.
2. Select a complete, authoritative Vault and resolve NFC-equivalent files or
   Metadata documents which would produce the same ID.
3. Set version `1` on the source client and Rebuild both databases from that
   Vault.
4. Set version `1` on each remaining client and Fetch the rebuilt remote.
5. Resume synchronisation only after every client has the same path identity.

In Obsidian, the setting remains pending through ordinary settings saves, the
settings-only Apply fallback, and reload. It becomes active only when the
existing Rebuild or Fetch operation is successfully reserved. A `remoteOnly`
operation cannot apply a pending identity change, and the settings-only
fallback is not offered. The Setup URI shares
`pathNormalizationVersion` so a new client receives the intended value;
importing that value does not replace the required Rebuild or Fetch operation.

The CLI exposes explicit `rebuild` and `fetch` commands. Both require
`--force` before application start-up because they replace local or remote
database state. `--force` confirms the requested operation; it does not bypass
identity checks, collision preflight, compatibility checks, or required human
remediation. The commands use the existing Commonlib Rebuilder; this change
does not introduce a second migration engine.

The migration procedure also uses `--write-settings` to retain the selected
local database and settings across subsequent CLI invocations. Collision
preflight uses the supported host listing and local Metadata. It refuses
ambiguous file or parent-directory candidates before database reconstruction;
it does not claim to detect physical aliases which a host does not expose.

## Alternatives considered

- **Use NFC by default:** rejected because existing clients and databases must
  retain their current IDs until their owners deliberately migrate them.
- **Normalise only lookups:** rejected because new Metadata writes and deletes
  could continue using legacy IDs and create duplicate documents.
- **Change `idDerivationVersion`:** rejected because it controls cryptographic
  ID derivation, not Unicode canonicalisation, and must remain meaningful when
  encryption is disabled.
- **Rename files to NFC:** rejected because the decision concerns logical
  identity, while physical spelling belongs to the Vault and its filesystem.
- **Rewrite remote IDs automatically or merge collisions:** rejected because
  changing document IDs cannot preserve CouchDB revision ancestry, and the
  system cannot choose safely between distinct file histories.

## Consequences

Legacy mode remains unchanged, and NFC identity requires a coordinated,
destructive Rebuild and Fetch. An ambiguity found in the supported storage
listing or local Metadata stops reconstruction before either database is
reset; the user must resolve the names or synchronisation scope. The check is
bounded by each host's listing contract: Obsidian uses its `TFile` and Vault
APIs and does not scan the physical Vault for aliases hidden by that index.
No claim is made that raw physical aliases outside a host's supported listing
are detected.

## References

- [Unicode path identity design](../design_docs/unicode_path_identity.md)
- [Setting details](../settings.md#unicode-path-identity)
- [User migration procedure](../recovery.md#migrate-to-unicode-nfc-path-identity)
- [Device-local file provenance](../specs_conflict_resolution.md#device-local-file-provenance)
- [Commonlib Unicode path identity contract](https://github.com/vrtmrz/livesync-commonlib/blob/main/docs/unicode-path-identity.md)
- [Project glossary](../glossary.md)
