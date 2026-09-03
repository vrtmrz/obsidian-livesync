---
date: 2026-09-03
commonlib-version: "0.1.21"
self-hosted-livesync-version: "1.0.24"
status: accepted
---

# Database Data Structures

## Scope and Authority

This document is a developer overview of the database structures used by the
current Self-hosted LiveSync 1.0 series. It is not a stable, forward-compatible
API for constructing CouchDB documents by hand.

The executable authority for document types, path and identifier encoding,
chunk splitting and hashing, encryption, compression, and content
reconstruction is the exact `@vrtmrz/livesync-commonlib` version recorded in
the repository lockfile. Commonlib owns this domain under the
[package-boundary decision](adr/2026_07_common_library_package_boundary.md).
When this overview and that installed package differ, correct this document
and treat the package behaviour as authoritative for the affected release.

Three representations must be distinguished:

1. the decoded application representation used by Commonlib services;
2. the local PouchDB representation, including CouchDB revision metadata; and
3. the raw remote representation after any configured compression, E2EE, or
   path-obfuscation transform.

The examples below describe the first two representations unless a section
explicitly discusses the raw remote representation. The exact raw remote shape
depends on the configured transforms and protocol version and cannot be
inferred from the decoded or local examples alone.

## Principal Document Families

- file Metadata, including compatibility-only legacy Metadata;
- Chunks and compatibility transport structures such as Chunk Packs;
- database version, synchronisation, Milestone, and Node information; and
- CouchDB revision and deletion records.

Commonlib's `EntryDoc` is a union across several of these families. It is not
synonymous with file Metadata.

## Common CouchDB Fields

Database documents share this base shape:

```ts
export interface DatabaseEntry {
    _id: DocumentID;
    _rev?: string;
    _deleted?: boolean;
    _conflicts?: string[];
}
```

- `_id` identifies one CouchDB document.
- `_rev` identifies one revision of that document.
- `_conflicts` is returned when conflict information is requested. It is
  CouchDB revision metadata, not part of the persisted application document.
- `_deleted: true` creates a CouchDB tombstone. It is distinct from the
  logical file-deletion field `deleted: true` described below.

## File Metadata

Current files are stored as chunked Metadata. The following is a simplified
shape; the exported Commonlib declarations remain authoritative:

```ts
type ChunkedMetadata = DatabaseEntry & {
    ctime: number;
    mtime: number;
    size: number;
    deleted?: boolean;
    eden: Record<string, { data: string; epoch: number }>;
    path: FilePathWithPrefix;
    children: string[];
    type: "plain" | "newnote";
};
```

`children` contains Chunk document IDs in reconstruction order. A normal save
persists every referenced Chunk before it persists the Metadata which names
those Chunks. The writes are separate database operations rather than one
atomic transaction, so another client may still observe the Metadata first.
The resulting retrieval contract is documented in
[Chunk Retrieval and Waiting](design_docs/chunk_retrieval_and_waiting.md).

The current persisted file types are:

- `plain`, for text content represented by literal text Chunks; and
- `newnote`, for binary content represented by Base64 Chunks.

The compatibility-only `notes` type stores content directly in its `data`
field rather than in `children`. Existing data may be read through selected
legacy paths, but current writers do not create `notes` documents, and not
every current replication path accepts newly created legacy documents.

`datatype` appears on Commonlib's loaded and saving representations. The
current Metadata writer does not persist it, so it is absent from ordinary
current CouchDB Metadata.

`eden` remains in the shared type for existing data compatibility. New
configuration does not enable Eden, and current writers do not create
incubated Eden Chunks for a new configuration.

### Times and Size

`ctime` and `mtime` are Unix epoch times in milliseconds. `size` is the byte
size of the decoded file content supplied by the storage boundary. Current
storage adapters and generated Blob paths obtain it from filesystem metadata
or `Blob.size`; JavaScript `String.length` is a UTF-16 code-unit count and is
not a valid substitute for non-ASCII content.

### Paths, Identifiers, and Namespaces

At the decoded boundary, `path` records the logical path, including any
feature namespace prefix. `_id` is derived from that path by Commonlib's path
service:

- a path beginning with `_` receives a leading `/` in its document ID so that
  CouchDB does not interpret it as a reserved identifier;
- the path is folded to lower case only when
  `handleFilenameCaseSensitive` is disabled; and
- when path obfuscation is enabled, the body of the document ID is replaced
  by an `f:` SHA-256-derived value. A feature prefix is retained, so an
  obfuscated Hidden File Sync ID can begin with `i:f:`.

The main namespaces are:

| Prefix | Meaning                                                 |
| ------ | ------------------------------------------------------- |
| none   | An ordinary Vault file                                  |
| `i:`   | Hidden File Sync Metadata                               |
| `ix:`  | Customisation Sync Metadata                             |
| `ps:`  | Compatibility namespace for plug-in storage data        |
| `f:`   | Obfuscated document-ID body                             |
| `h:`   | Chunk document                                          |
| `h:+`  | Chunk whose identifier incorporates encryption material |

Namespaces identify storage and path handling; they do not by themselves
select an Entry `type`. Current Hidden File Sync and Customisation Sync writers
store chunked `plain` or `newnote` documents under `i:` and `ix:`. The
application-local `type: "plugin"` interface is not a Commonlib Entry type and
is not the current Customisation Sync storage format. Although Commonlib
retains an `internalfile` constant for compatibility, current Hidden File Sync
producers do not use it as their persisted type.

The decoded `path` does not become `f:{obfuscated path}`. Compression, E2EE,
and path obfuscation can change raw remote identifiers and properties.
Commonlib owns those transforms, and their exact representation depends on the
selected settings.

The validation and explicit repair contract for ordinary-file Metadata whose
stored `_id` does not agree with its decoded `path` is defined in
[Normal-file Metadata Document ID Validation and Repair](design_docs/metadata_document_id_validation_and_repair.md).

## Chunk Documents

```ts
export type EntryLeaf = DatabaseEntry & {
    type: "leaf";
    data: string;
    isCorrupted?: boolean;
};
```

A `leaf` stores one content-addressed piece. For `plain` Metadata, `data` is
literal text. For `newnote` Metadata, `data` is Base64 text representing binary
bytes. Concatenating and decoding the children in order reconstructs the
decoded file content.

Commonlib's configured `HashManager` produces content-derived Chunk
identifiers. Their representation can vary with compatibility and encryption
settings. Historical hash algorithms remain readable only as compatibility
settings.

Chunk revisions are content-derived irrespective of the obsolete stored
`doNotUseFixedRevisionForChunks` setting. Compression and E2EE may transform a
Chunk's raw remote `data` and add representation markers, so the remote value
can differ from the decoded Chunk data.

## File Deletion

LiveSync distinguishes two operations:

- `deleted: true` is a logical deletion of a file. With Metadata retention
  enabled, an ordinary current-file deletion preserves the existing Metadata
  fields and Chunk references, updates `mtime`, and creates a new Metadata
  revision. This permits the deletion to participate in synchronisation and
  conflict history.
- `_deleted: true` is a CouchDB tombstone for one document revision. That
  revision does not retain the application body. Tombstones are used by
  explicit compatibility and clean-up paths.

A logical deletion does not clear `children` or set `size` to zero. The
`deleteMetadataOfDeletedFiles` setting can request an immediate tombstone
instead. Whether retained, logically deleted Metadata is later tombstoned
depends on the configured deletion-retention settings.

Branch-specific conflict operations and their ancestry requirements are defined
in the [Conflict Resolution specification](specs_conflict_resolution.md).

## Control Documents

The principal control documents are:

| Document                           | Identifier                                        | Purpose                                                                                                  |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Version information                | `obsydian_livesync_version`                       | Records the internal database version. The historical spelling is retained for compatibility.            |
| Synchronisation information        | `syncinfo`                                        | Stores rebuild-related synchronisation information for CouchDB-based operation.                          |
| CouchDB synchronisation parameters | `_local/obsidian_livesync_sync_parameters`        | Stores the protocol version and PBKDF2 salt on the remote.                                               |
| Journal synchronisation parameters | `_obsidian_livesync_journal_sync_parameters.json` | Journal counterpart of the synchronisation-parameter record.                                             |
| Milestone information              | `_local/obsidian_livesync_milestone`              | Records accepted Nodes, locking, clean-up state, Chunk version ranges, and synchronisation tweak values. |
| Node information                   | `_local/obsidian_livesync_nodeinfo`               | Records the local Node identifier and compatibility markers.                                             |

The `_local/` records are CouchDB-local documents and do not replicate like
ordinary Metadata and Chunks. Synchronisation parameters are checked before
connecting; an incompatible protocol or encryption configuration stops
synchronisation rather than being ignored.
