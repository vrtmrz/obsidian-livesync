# CouchDB API Compatibility Specification for Self-hosted LiveSync

This document is a comprehensive technical specification for building external software (bots, automation tools, integrations) that reads from or writes to a CouchDB database managed by [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync). It is derived from deep source-code analysis (plugin repository and the `livesync-commonlib` type declarations under `_types/`) and community-reported findings.

**Spec revision:** aligned with plugin v0.25.80, protocol version `VER = 12`.

---

## Table of Contents

1. [Overview](#overview)
2. [Database Document Types](#database-document-types)
3. [Document ID Conventions](#document-id-conventions)
4. [Note Document Structure](#note-document-structure)
5. [Chunk (Leaf) Documents](#chunk-leaf-documents)
6. [Chunking Algorithm](#chunking-algorithm)
7. [Delete Operations](#delete-operations)
8. [Special / System Documents](#special--system-documents)
9. [Internal & Config-Sync Documents](#internal--config-sync-documents)
10. [Sync & Replication Protocol](#sync--replication-protocol)
11. [Conflict Resolution](#conflict-resolution)
12. [End-to-End Encryption & Path Obfuscation](#end-to-end-encryption--path-obfuscation)
13. [Field Reference](#field-reference)
14. [Protocol Constants](#protocol-constants)
15. [Common Failure Modes](#common-failure-modes)
16. [Minimal Working Examples](#minimal-working-examples)

---

## Overview

Self-hosted LiveSync stores Obsidian vault files in CouchDB using PouchDB's replication protocol. Each file is stored as one or more CouchDB documents:

- A **note document** (type `"plain"` for text files, `"newnote"` for binary files) that holds metadata and references to content chunks.
- One or more **chunk (leaf) documents** (type `"leaf"`) that hold the actual file content, referenced by the note's `children` array.

LiveSync clients watch the CouchDB `_changes` feed and apply incoming documents to the local vault filesystem. For a document to be correctly processed by a client, it must conform strictly to the rules below.

---

## Database Document Types

The authoritative `type` literals (from commonlib `EntryTypes`):

| `type` value | Role | `_id` pattern |
|---|---|---|
| `"plain"` | File document, **plain-text** content | lowercase path |
| `"newnote"` | File document, **binary** content (base64 chunks) | lowercase path |
| `"notes"` | File document, legacy format with inline `data` (no `children`) | lowercase path |
| `"internalfile"` | Hidden/internal file entry | `i:` + lowercase path |
| `"leaf"` | Chunk of file content | `h:<hash>` (or `h:+<hash>` when E2EE) |
| `"chunkpack"` | Packed group of chunks | (managed by LiveSync) |
| `"versioninfo"` | Protocol version marker | special ID |
| `"syncinfo"` | Synchronisation state | `SYNCINFO_ID` |
| `"sync-parameters"` | Sync parameter document | special ID |
| `"milestoneinfo"` | Node/device milestone + lock/tweak state | `MILESTONE_DOCID` |
| `"nodeinfo"` | Per-node identity | `NODEINFO_DOCID` |
| `"plugin"` | Plugin data (customization sync, plugin-repo level) | `ix:<term>/<category>/<name>` |

Notes:
- `"plain"` vs `"newnote"` is a **content-encoding distinction**, not old-vs-new: `determineType(path, data)` picks `"plain"` for recognized text and `"newnote"` for binary. The `datatype` field carries the same literal (`EntryTypeNotes = "newnote" | "plain"`).
- `"notes"` (`NOTE_LEGACY`) is the pre-chunking legacy shape: content lives inline in `data` and there is no `children` array. Clients still accept it; do not create it in new integrations.
- Clients ignore documents whose `type`/`_id` do not match a recognized pattern.

---

## Document ID Conventions

These rules are enforced by LiveSync when it reads documents from the change feed. A document that violates them will be silently ignored.

### ID prefix map

All prefixes, from commonlib constants (`fileaccess.const` / `IDPrefixes`):

| Prefix | Constant | Meaning |
|---|---|---|
| `h:` | `CHeader` / `IDPrefixes.Chunk` | Chunk (leaf) document |
| `h:+` | `IDPrefixes.EncryptedChunk` | Chunk whose ID hash was computed **with E2EE** (`+` = `HashEncryptedPrefix`) |
| `f:` | `IDPrefixes.Obfuscated` | Path-obfuscated document ID (see [E2EE section](#end-to-end-encryption--path-obfuscation)) |
| `i:` | `ICHeader` | Internal / hidden file (`.obsidian/**`); end marker `i;` (`ICHeaderEnd`) |
| `ix:` | `ICXHeader` | Customization-sync (plugins/themes/snippets) document |
| `ps:` | `PSCHeader` | Plugin-settings document (end marker `ps;`) |
| *(none)* | — | Regular note document: lowercase file path |

### 1. Note document IDs must be the lowercase file path

```
_id  =  lowercase( normalizePath( filePath ) )
```

- All ASCII letters are lowercased (when the vault handles files case-insensitively — the default for new setups; `handleFilenameCaseSensitive` setting, supported since setting version 10).
- Path separators are always forward slashes (`/`), never backslashes.
- The ID does **not** include a leading slash.
- The `path` field retains the original mixed-case path.

```jsonc
// File: "Folder/My Note.md"
{
  "_id":  "folder/my note.md",   // lowercase
  "path": "Folder/My Note.md"    // original case
}
```

> **Source:** `src/common/utils.ts` — `path2id()` wraps commonlib `path2id_base(fixedPath, obfuscatePassphrase, caseInsensitive)`.

### 2. Underscore-prefixed files must use a `/_` workaround

CouchDB forbids document IDs that begin with `_`. For files whose name starts with `_`, LiveSync prefixes the ID with `/` so that the leading `_` is no longer the first character:

```
File "_templates/foo.md"  →  _id "/_templates/foo.md"
```

> **Source:** comment in `src/common/utils.ts`: "Only CouchDB unacceptable ID (that starts with an underscore) has been prefixed with '/'. The first slash will be deleted when the path is normalized."

**External writers must not create IDs starting with `_`** (other than the CouchDB-reserved fields `_id`, `_rev`, `_deleted`, `_conflicts`, etc.).

### 3. Chunk IDs use the `h:` prefix

```
_id  =  "h:" + <hash>          // plain
_id  =  "h:+" + <hash>         // when E2EE is enabled (encrypted-hash chunks)
```

The hash is computed from the chunk's raw content by the configured hash algorithm (see [Chunking Algorithm](#chunking-algorithm)) and hex-encoded — so for unencrypted databases the ID after `h:` is **alphanumeric only** (no `+`, `/`, `=`, spaces, or other URL-unsafe characters). LiveSync uses `isChunk(id)` to route these documents to the leaf processor instead of the normal note processor.

> A chunk ID beginning `h:+` is only valid on an E2EE-enabled database. If you see `"No chunks were found for the following IDs: h:+..."` on a non-encrypted database, an external writer produced a malformed ID (e.g. raw base64 containing `+`).

### 4. Internal hidden-file IDs use the `i:` prefix

Obsidian hidden / internal files (`.obsidian/**`) are stored with the prefix `i:` (`ICHeader`):

```
_id  =  "i:" + lowercase( normalizePath( relativePath ) )
```

These should not be created by external tools unless you are intentionally syncing Obsidian configuration.

### 5. Customization-sync IDs use the `ix:` prefix

Plugin data, themes, and snippets managed by LiveSync's "Customization sync" feature use the `ix:` prefix (`ICXHeader`):

```
_id  =  "ix:<term>/<category>/<name>.md"          (for .md files)
_id  =  "ix:<term>/<category>/<name>%<baseName>"  (for others)
```

External tools should avoid writing to these documents.

---

## Note Document Structure

### Minimal valid document

```jsonc
{
  "_id":      "folder/my note.md",     // lowercase path (required)
  "path":     "Folder/My Note.md",     // original-case path (required)
  "type":     "plain",                  // "plain" (text) or "newnote" (binary)
  "children": ["h:abc123def456"],       // chunk ID array (required)
  "size":     42,                       // file size in bytes (required)
  "mtime":    1707123456789,            // modification time, ms since epoch (required)
  "ctime":    1707123456789,            // creation time, ms since epoch (required)
  "datatype": "plain",                  // mirrors "type" (recommended)
  "eden":     {}                        // required by the type; keep as {} unless using Eden
}
```

### Field details

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | string | yes | Lowercase normalized path; see ID conventions |
| `_rev` | string | CouchDB managed | Set by CouchDB on PUT; include on updates |
| `path` | string | yes | Original-case path as stored in the vault (`FilePathWithPrefix`) |
| `type` | `"plain"` \| `"newnote"` | yes | `"plain"` = text file, `"newnote"` = binary file |
| `children` | string[] | yes | Array of `h:<hash>` chunk IDs, in content order |
| `data` | string \| string[] | legacy | Only on legacy `"notes"` documents (inline content). Chunked docs carry content in leaves |
| `size` | number | yes | Byte length of the original file content |
| `mtime` | number | yes | Last-modified timestamp in **milliseconds** since Unix epoch |
| `ctime` | number | yes | Creation timestamp in **milliseconds** since Unix epoch |
| `datatype` | `"plain"` \| `"newnote"` | recommended | Mirrors `type` (`EntryTypeNotes`) |
| `deleted` | boolean | no | Application-level soft-delete flag (distinct from `_deleted`) |
| `eden` | `Record<DocumentID, {data, epoch}>` | yes (type-level) | Eden chunk store; **non-optional in the type**. Keep `{}` unless the Eden feature (`useEden`) is in use |
| `_deleted` | boolean | CouchDB | Hard-delete / tombstone. Set `true` to fully remove from active DB |
| `_conflicts` | string[] | CouchDB | Native conflict tracking; managed by PouchDB/CouchDB |

> **Type source:** commonlib `db.type.d.ts` — `NoteEntry` (legacy, inline data), `NewEntry` (binary, chunked), `PlainEntry` (text, chunked), all `DatabaseEntry & EntryBase & EntryWithEden`. `AnyEntry = NoteEntry | NewEntry | PlainEntry | InternalFileEntry`.

### The `eden` field

`eden` is typed `Record<DocumentID, EdenChunk>` where `EdenChunk = { data: string; epoch: number }`. It embeds small "newborn" chunks directly in the note document when the optional Eden feature (`useEden`, `maxChunksInEden`, `maxTotalLengthInEden`, `maxAgeInEden` settings) is enabled. The feature is disabled by default and its settings are hidden in the current UI, but the field is **non-optional in the schema** — always include it (as `{}`) for compatibility.

---

## Chunk (Leaf) Documents

When a file is stored, its content is split into chunks. Each chunk is a separate CouchDB document.

```jsonc
{
  "_id":  "h:abc123def456",   // "h:" + hex hash ("h:+..." when E2EE)
  "type": "leaf",
  "data": "# Note content here\n\nSome more text..."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | string | yes | `h:` + hash of content (`h:+` variant when E2EE) |
| `type` | `"leaf"` | yes | Identifies this as a chunk |
| `data` | string | yes | The chunk content (raw text for `"plain"` parents, base64 for `"newnote"` parents; ciphertext when E2EE) |
| `isCorrupted` | boolean | no | Set by LiveSync when a chunk fails integrity checks |
| `_deleted` | boolean | no | Tombstone (set during compaction/GC) |

**Chunks are immutable.** The same content always produces the same ID. Do not update an existing chunk document — create new chunks with new IDs if content changes.

**Chunk revisions can be deterministic.** With the default setting "Compute revisions for chunks" (`doNotUseFixedRevisionForChunks` disabled), leaf documents get content-derived `_rev` values so identical chunks written by different devices don't create revision churn. External writers can let CouchDB assign revisions normally; but be aware some maintenance features require this setting on.

Clients detect chunks via `isChunk(_id)` (prefix test). Chunks bypass the normal note-processing pipeline and are stored directly (`onNewLeaf`).

---

## Chunking Algorithm

### Hash algorithms

LiveSync supports multiple hash algorithms, selectable per-database via the `hashAlg` setting (commonlib `HashAlgorithms`):

| Setting value | Algorithm | Notes |
|---|---|---|
| `""` | Legacy algorithm | Older installations |
| `"xxhash32"` | xxHash 32-bit | Fast; lower collision resistance |
| `"xxhash64"` | xxHash 64-bit | Fastest; recommended/default |
| `"mixed-purejs"` | Pure-JS fallback | No WebAssembly required |
| `"sha1"` | SHA-1 | Slow fallback; no WebAssembly required |

The hash output is hex-encoded. The chunk `_id` is `"h:" + hash`; when E2EE is enabled the hash is computed over encrypted material and prefixed with `+` (giving `"h:+..."`). Pipeline: `HashManager.computeHash(piece)` → `prepareChunk()` → `GeneratedChunk { isNew, id, piece }`.

### Content splitters

The splitter that decides chunk boundaries is also versioned (`ChunkAlgorithms`):

| Value | Splitter |
|---|---|
| `"v1"` | Original splitter |
| `"v2"` | Newer text splitter |
| `"v2-segmenter"` | v2 using `Intl.Segmenter` |
| `"v3-rabin-karp"` | Rabin–Karp content-defined chunking |

Relevant size constants (commonlib): `MAX_DOC_SIZE = 1000` (bytes, note-level threshold), `MAX_DOC_SIZE_BIN = 102400` (100 KiB, binary), and the user-configurable `minimumChunkSize`. Chunk boundaries are implementation detail — **readers must simply concatenate `children` leaf `data` in order**; writers may produce chunks at any reasonable boundaries as long as each chunk's ID matches the configured hash of its content.

### Safe chunk ID generation (if you cannot use xxhash)

Because `hashAlg` is configurable per database, match whatever the target database already uses (inspect existing chunk IDs / settings). SHA-1 hex output (`h:<sha1hex>`) is compatible with the `"sha1"` setting. Do **not** use URL-unsafe characters in the ID — raw base64 output (`+`, `/`, `=`) will break chunk retrieval.

---

## Delete Operations

LiveSync uses **two separate deletion mechanisms**. Mixing them up is the most common cause of delete operations not propagating to clients.

### Mechanism 1 — Soft delete (`deleted: true`)

A soft delete marks the file as deleted while preserving the document's history in CouchDB. The document remains visible in `_all_docs` and the `_changes` feed.

```jsonc
{
  "_id":     "folder/my note.md",
  "_rev":    "2-abc...",
  "path":    "Folder/My Note.md",
  "type":    "plain",
  "children": [],
  "size":    0,
  "mtime":   1707999999999,
  "ctime":   1707123456789,
  "eden":    {},
  "deleted": true              // <-- soft delete
}
```

**Behaviour:**
- The file is removed from the vault on all synced clients.
- The document is retained in CouchDB for conflict resolution and history.
- After `automaticallyDeleteMetadataOfDeletedFiles` days (a LiveSync setting), the soft-deleted document is automatically promoted to a hard delete (`_deleted: true` is set and the doc is PUT back).

> **Source:** `src/modules/essential/ModuleInitializerFile.ts` (`collectDeletedFiles`).

### Mechanism 2 — Hard delete (CouchDB tombstone, `_deleted: true`)

A hard delete uses CouchDB's native tombstone mechanism. After this, the document only exists as a tombstone and is eventually purged during compaction.

**Behaviour:**
- Propagates to clients via the `_changes` feed as a deletion event.
- LiveSync checks both flags simultaneously wherever deletion matters:
  ```typescript
  const isDeleted = doc._deleted === true || ("deleted" in doc && doc.deleted === true);
  ```
  (commonlib also exposes `isDeletedEntry(doc)` combining both.)
- A hard-deleted document produces `data: ""` when gathered for storage application.

> **Source:** `src/modules/core/ReplicateResultProcessor.ts`.

### Recommended delete procedure for external writers

1. **Fetch** the current document (to get the latest `_rev`).
2. **PUT** an updated document with `"deleted": true` (soft delete), keeping all required fields and bumping `mtime`.
3. Do **not** set `_deleted: true` directly from external tools unless you intend a permanent hard delete with no recovery window.

> **Why toggling `deleted: false → true` may not work:** If the `_rev` is stale, CouchDB returns 409 Conflict — or worse, your write lands as a *conflicting revision* that the client parks for manual resolution instead of applying. Always fetch the current document first.

---

## Special / System Documents

These documents are managed exclusively by LiveSync and must not be created or modified by external tools.

| Document | `type` | Purpose |
|---|---|---|
| `SYNCINFO_ID` | `"syncinfo"` | Sync state between devices; carries a `data` string |
| `MILESTONE_DOCID` | `"milestoneinfo"` | Node registry, remote **lock state** (`locked`, `cleaned`), per-node chunk version ranges (`node_chunk_info`), and shared tweak values (`tweak_values`) |
| `NODEINFO_DOCID` | `"nodeinfo"` | Per-node identity (`nodeid`) |
| (version doc) | `"versioninfo"` | Protocol version; `version` field compared against `VER = 12`. If remote `version > VER`, clients stop replicating and ask the user to update |
| — | `"sync-parameters"` | Sync parameter document |
| `_design/*` | — | CouchDB design documents; skipped by replication processing |

The milestone document matters indirectly to external tools: when `locked: true` (e.g. after a remote rebuild), clients refuse to sync until fetched/unlocked. An external writer cannot "unlock" safely — leave this document alone.

Change-feed classification order (`ReplicateResultProcessor.processIfNonDocumentChange`):
1. `isChunk(_id)` → leaf fast path.
2. `type == "versioninfo"` → version check.
3. `_id == SYNCINFO_ID` or `_id.startsWith("_design")` → skip.
4. Otherwise → note-document pipeline.

---

## Internal & Config-Sync Documents

### Hidden / internal Obsidian files (`i:` prefix)

Files inside `.obsidian/` are stored with `ICHeader` (`i:`), type `"internalfile"` (structurally a `NewEntry` + `deleted?`). Only synced if the user enabled **hidden file sync**.

### Customization sync documents (`ix:` prefix)

Managed by LiveSync's customization-sync feature (`ICXHeader` = `ix:`):

```
_id = "ix:<term>/<category>/<filename>"
```

Where `<term>` is a device/vault identifier, `<category>` is e.g. `plugins`, `themes`, `snippets`.

### Plugin data documents (`type: "plugin"`)

```jsonc
{
  "_id":             "ix:deviceName/plugins/my-plugin.md",
  "type":            "plugin",
  "deviceVaultName": "MyVault",
  "mtime":           1707123456789,
  "manifest":        { /* PluginManifest */ },
  "mainJs":          "...",
  "manifestJson":    "...",
  "styleCss":        "...",
  "dataJson":        "..."    // may be encrypted
}
```

---

## Sync & Replication Protocol

### How LiveSync watches for changes

LiveSync uses PouchDB replication against the remote CouchDB, consuming the `_changes` feed with `include_docs: true`. Incoming changes are batched via `enqueueAll()` and processed with a semaphore (max 10 concurrent). Since v0.25.79/80 the event plumbing uses a `StreamInbox` helper and **Fast Fetch resumes from the latest persisted checkpoint** after a stream interruption instead of restarting the feed — client-side resilience only, no server-visible protocol change.

### Processing pipeline

```
_changes feed
  └─> enqueueAll()
        └─> processIfNonDocumentChange()   // chunks, versioninfo, syncinfo → fast path
              └─> enqueueChange()          // deduplicates by _id
                    └─> runProcessQueue()  // semaphore-limited
                          └─> parseDocumentChange()
                                └─> applyToDatabase()  → applyToStorage()
```

### Change deduplication

If the same `_id` is queued multiple times before processing, LiveSync replaces the earlier entry with the newer one **only if the deletion state is the same** (`isDeletedBefore === isDeletedNow`). A transition between deleted and non-deleted is always kept as a separate change.

### Staleness check

Before applying a document to local storage, LiveSync checks whether the incoming `_rev` is still the latest (using `revs_info`). If the revision was already processed, the change is skipped — unless `_conflicts` is non-empty, which always triggers processing.

### Chunk availability

When a note document arrives before its chunks, the client waits up to `LEAF_WAIT_TIMEOUT` (30 s) for missing leaves (5 s in sequential-replicator/remote-only modes). **Write chunks before the note that references them** to avoid this stall entirely.

### Filters applied to incoming documents

LiveSync silently skips documents that fail any of these checks:

| Check | Notes |
|---|---|
| `isFileSizeTooLarge(size)` | Files over the configured size limit |
| `isValidPath(path)` | Path must be valid for the client's OS |
| `isTargetFile(path)` | Must match vault sync filters |
| `mtime > maxMTimeForReflectEvents` | Used during remediation mode |

---

## Conflict Resolution

### Detection

Conflicts are detected via PouchDB's `_conflicts` array. Any document with a non-empty `_conflicts` array is re-processed even if its `_rev` matches the local copy. Resolution works by **deleting the losing revision** (`deleteRevisionFromDB`) and re-checking until no conflicts remain; storage is only written once the doc is conflict-free.

### Conflict Merge Policy (v0.25.80+)

Upstream formalized a **conservative three-way merge policy** (see `devs.md` "Conflict Merge Policy"; issues #993/#994). The guiding rule: *when in doubt, preserve data and keep the conflict visible rather than silently discarding content or picking a side.*

For plain-text/markdown documents:

1. **Non-overlapping edits** in different regions → auto-merged.
2. **One side deletes a line the other left unchanged** → the deletion is honored and merged; the deleted line is **not reintroduced** (fixed in #993 — previously it could resurrect or fail the merge).
3. **One side deletes a line the other side modified** → **conflict preserved for the user**; no silent winner.
4. **Both sides insert different content at the same position** → both kept in deterministic order, unless the surrounding context marks them as competing replacements — then a conflict is preserved.
5. **Newest-wins is never applied implicitly** — only when the user explicitly enabled `resolveConflictsByNewerFile`.

For applying an incoming (replicated) entry to local storage (#994):

- A newer incoming **text** entry is applied *without* creating a conflict **only when it clearly extends the existing local text** — i.e. the local content is a strict prefix or suffix of the incoming content.
- Otherwise, if local storage may hold unsynchronised changes, the local file is stored back into the DB as a **conflicted revision** (`storeAsConflictedRevision`) instead of being overwritten. Timestamp ties err toward preserving a conflict.

Other strategies (unchanged):

- **Identical content** (same `data`, same `deleted` flag) → resolved by newer `mtime`.
- **Binary files** → always resolved by newer `mtime` (no content merge).
- **Failed auto-merge** → user is prompted to pick a revision.

### Implications for external writers

1. **Append-style writes are the friendly case.** If your write's text clearly extends what clients already have (prefix/suffix), it applies cleanly with no conflict.
2. **Don't rely on mtime/newest-wins.** A newer `mtime` does not make your write win; ambiguous overlaps become user-facing conflicts, and LiveSync deliberately will not discard the user's local data to take your write.
3. **Always GET before PUT** to obtain the current `_rev`; a stale-rev write either 409s or lands as a conflicted revision awaiting manual resolution.
4. **Expect your ambiguous writes to appear in `_conflicts`** rather than clobbering the current revision — that is intended behavior, not a bug.

> **Note:** the merge logic itself lives in the `livesync-commonlib` submodule (`ConflictManager.ts`, `ServiceFileHandlerBase.ts`), not in this repository's `src/`.

---

## End-to-End Encryption & Path Obfuscation

LiveSync supports optional E2EE. When enabled:

- `data` fields in chunk documents are encrypted (AES-GCM via Web Crypto, implemented in commonlib).
- Chunk IDs are computed over encrypted material and carry the `h:+` prefix.
- With **path obfuscation** (`usePathObfuscation`), document IDs are replaced by an obfuscated value with the `f:` prefix instead of the path-derived ID. Per the setting's own doc: *"If not, the path will be stored as it is, as the document ID."* Obfuscation salts (`SALT_OF_PASSPHRASE`, `SALT_OF_ID`) are fixed constants in commonlib.

**If your integration targets an E2EE-enabled database, this specification does not apply in its current form** — you must implement the same encryption scheme. A practical signal: document IDs starting with `f:` (obfuscated paths) or chunk IDs starting with `h:+` mean encryption/obfuscation is active.

---

## Field Reference

### Complete note document schema

```typescript
interface NoteDocument {
  // CouchDB / PouchDB managed
  _id:        string;           // lowercase normalized path (or "f:..." when obfuscated)
  _rev?:      string;           // must be included on updates
  _deleted?:  boolean;          // CouchDB tombstone; omit on normal writes
  _conflicts?: string[];        // conflict revision IDs (read-only)

  // Required LiveSync fields
  path:       string;           // original-case path (FilePathWithPrefix)
  type:       "plain" | "newnote";  // text | binary ("notes" = legacy inline)
  children:   string[];         // ["h:<hash>", ...] in content order
  size:       number;           // bytes
  mtime:      number;           // milliseconds since epoch
  ctime:      number;           // milliseconds since epoch
  eden:       Record<string, { data: string; epoch: number }>;  // {} unless Eden in use

  // Recommended
  datatype?:  "newnote" | "plain";  // mirrors type

  // Optional state
  deleted?:   boolean;          // application-level soft-delete flag

  // Legacy only ("notes" type)
  data?:      string | string[];
}
```

### Complete chunk (leaf) schema

```typescript
interface ChunkDocument {
  _id:          string;   // "h:" + hash ("h:+" + hash when E2EE)
  type:         "leaf";
  data:         string;   // chunk content (text / base64 / ciphertext)
  isCorrupted?: boolean;  // set by LiveSync on integrity failure
  _deleted?:    boolean;  // set true to purge chunk
}
```

---

## Protocol Constants

From commonlib (`shared.const.behabiour.d.ts`, `fileaccess.const.d.ts`):

| Constant | Value | Meaning |
|---|---|---|
| `VER` | `12` | Protocol version; remote `versioninfo.version > VER` halts clients |
| `MAX_DOC_SIZE` | `1000` | Note-level size threshold (bytes) |
| `MAX_DOC_SIZE_BIN` | `102400` | Binary size threshold (100 KiB) |
| `LEAF_WAIT_TIMEOUT` | `30000` | ms to wait for missing chunks |
| `LEAF_WAIT_ONLY_REMOTE` | `5000` | ms to wait when fetching chunks remotely |
| `CHeader` | `"h:"` | Chunk ID prefix |
| `ICHeader` / `ICHeaderEnd` | `"i:"` / `"i;"` | Internal-file ID prefix / range end |
| `ICXHeader` | `"ix:"` | Customization-sync ID prefix |
| `PSCHeader` / `PSCHeaderEnd` | `"ps:"` / `"ps;"` | Plugin-settings ID prefix / range end |
| `PREFIX_OBFUSCATED` | `"f:"` | Obfuscated-path ID prefix |
| `PREFIX_ENCRYPTED_CHUNK` | `"h:+"` | Encrypted chunk ID prefix |

---

## Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Document in CouchDB but not appearing in Obsidian | `_id` has uppercase letters | Lowercase the `_id`; keep original case in `path` |
| `"Failed to read file: Possibly unprocessed or missing"` | `children` references a chunk that doesn't exist yet | Write all chunk documents **before** writing the note document |
| `"No chunks were found for the following IDs: h:+..."` on a non-E2EE database | Chunk `_id` contains URL-unsafe characters (e.g. raw base64 `+`) — note `h:+` is reserved for encrypted chunks | Use only hex/alphanumeric hash output in chunk IDs |
| Delete not propagating to clients | Stale `_rev`, or only `_deleted` toggled without required fields | GET current doc, then PUT with `deleted: true`, fresh `_rev`, bumped `mtime` |
| 409 Conflict on write | Writing without current `_rev` | Always GET before PUT |
| Write "accepted" but vault shows old content + conflict marker | Your edit overlapped local changes; LiveSync preserved a conflict rather than overwriting (v0.25.80 policy) | Expected. Prefer append-style edits, or resolve the conflict in Obsidian |
| Documents silently ignored | `path` invalid for the client's OS | Avoid characters forbidden on Windows (`<>:"/\|?*`) for cross-platform vaults |
| Binary file not rendering | `data` not base64-encoded / wrong `type` | Binary files use `type: "newnote"` with base64 chunk data |
| Client refuses to sync at all | Remote `milestoneinfo` is `locked` (e.g. after rebuild) or `versioninfo.version > 12` | User must fetch/unlock or update the plugin; do not touch these docs |

---

## Minimal Working Examples

> These examples target a **non-encrypted** database using chunked storage. Write chunks first, then the note.

### Create a new text note

```javascript
// 1. Create chunk(s) first
const content = "# Hello World\n";
const chunkHash = xxhash64hex(content);      // match the DB's hashAlg; hex output
await db.put({
  _id:  `h:${chunkHash}`,
  type: "leaf",
  data: content
});

// 2. Create the note document referencing the chunk
await db.put({
  _id:      "mynote.md",           // lowercase
  path:     "MyNote.md",           // original case
  type:     "plain",
  children: [`h:${chunkHash}`],
  size:     content.length,
  mtime:    Date.now(),
  ctime:    Date.now(),
  datatype: "plain",
  eden:     {}
});
```

### Update an existing note

```javascript
// 1. Fetch current document
const existing = await db.get("mynote.md");

// 2. Write new chunk(s), then PUT the note with fresh children and _rev
const newContent = "# Hello World\n\nAppended line.\n";  // extending = conflict-friendly
const newHash = xxhash64hex(newContent);
await db.put({ _id: `h:${newHash}`, type: "leaf", data: newContent });

await db.put({
  ...existing,                      // keeps _rev
  children: [`h:${newHash}`],
  size:     newContent.length,
  mtime:    Date.now()
});
```

### Soft-delete a note

```javascript
const existing = await db.get("mynote.md");
await db.put({
  ...existing,
  deleted:  true,
  children: [],
  size:     0,
  mtime:    Date.now()
});
```

---

*Derived from source analysis of obsidian-livesync at v0.25.80 (commit `4ad88ea`, commonlib types at `87dc724`), the `devs.md` Conflict Merge Policy, and community findings in issue [vrtmrz/obsidian-livesync#795](https://github.com/vrtmrz/obsidian-livesync/issues/795).*
