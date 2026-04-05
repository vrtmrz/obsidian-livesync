# CouchDB API Compatibility Specification for Self-hosted LiveSync

This document is a comprehensive technical specification for building external software (bots, automation tools, integrations) that reads from or writes to a CouchDB database managed by [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync). It is derived from deep source-code analysis and community-reported findings.

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
14. [Common Failure Modes](#common-failure-modes)
15. [Minimal Working Examples](#minimal-working-examples)

---

## Overview

Self-hosted LiveSync stores Obsidian vault files in CouchDB using PouchDB's replication protocol. Each file is stored as one or more CouchDB documents:

- A **note document** (type `"plain"` or `"newnote"`) that holds metadata and optionally inline content.
- One or more **chunk (leaf) documents** (type `"leaf"`) that hold the actual file bytes, referenced by the note's `children` array.

LiveSync clients watch the CouchDB `_changes` feed and apply incoming documents to the local vault filesystem. For a document to be correctly processed by a client, it must conform strictly to the rules below.

---

## Database Document Types

| `type` value | Role | `_id` pattern |
|---|---|---|
| `"plain"` | Note / file (current format) | lowercase path |
| `"newnote"` | Note / file (legacy format, still accepted) | lowercase path |
| `"leaf"` | Chunk of file content | `h:<hash>` |
| `"versioninfo"` | Protocol version marker | (special, set by LiveSync) |
| `"plugin"` | Plugin data (config-sync) | `x:<term>/<category>/<name>` |
| *(no type field)* | Sync-info or milestone metadata | special IDs |

Clients reject any document whose `type` is not one of the above or that does not match a recognized `_id` pattern.

---

## Document ID Conventions

These rules are enforced by LiveSync when it reads documents from the change feed. A document that violates them will be silently ignored.

### 1. Note document IDs must be the lowercase file path

```
_id  =  lowercase( normalizePath( filePath ) )
```

- All ASCII letters are lowercased.
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

> **Source:** `src/common/utils.ts:39–51` — `path2id()` calls `path2id_base()` with `caseInsensitive` flag.

### 2. Underscore-prefixed files must use a `/_` workaround

CouchDB forbids document IDs that begin with `_`. For files whose name starts with `_`, LiveSync historically prefixes the ID with `/` so that the leading `_` is no longer the first character. After path normalization the leading `/` is removed, so the effective ID becomes just the original path (without transformation). In practice:

- If the vault is configured **case-insensitive** and the file is `_myfile.md`, the ID is stored as `_myfile.md` only after the `/` prefix trick resolves it.
- **External writers must not create IDs starting with `_`** (other than the CouchDB-reserved fields `_id`, `_rev`, `_deleted`, `_conflicts`, etc.).

> **Source:** `src/common/utils.ts:37` comment and `path2id_base` in the commonlib submodule.

### 3. Chunk IDs use the `h:` prefix

```
_id  =  "h:" + <hash>
```

The hash is computed from the chunk's raw content using one of the supported algorithms (see [Chunking Algorithm](#chunking-algorithm)). The resulting string must be **alphanumeric only** (no `+`, `/`, `=`, spaces, or other URL-unsafe characters). LiveSync uses `isChunk(id)` — which tests for the `h:` prefix — to route these documents to the leaf processor instead of the normal note processor.

### 4. Internal hidden-file IDs use the `i:` prefix

Obsidian hidden / internal files (`.obsidian/**`) are stored with the prefix `i:` (the value of `ICHeader`). These should not be created by external tools unless you are intentionally syncing Obsidian configuration.

```
_id  =  "i:" + lowercase( normalizePath( relativePath ) )
```

### 5. Config-sync (plugin/snippet/theme) IDs use the `x:` prefix

Plugin data, themes, and snippets managed by LiveSync's "Customization sync" feature use the `x:` prefix (`ICXHeader`):

```
_id  =  "x:<term>/<category>/<name>.md"   (for .md files)
_id  =  "x:<term>/<category>/<name>%<baseName>"   (for others)
```

External tools should avoid writing to these documents.

---

## Note Document Structure

### Minimal valid document

```jsonc
{
  "_id":      "folder/my note.md",     // lowercase path (required)
  "path":     "Folder/My Note.md",     // original-case path (required)
  "type":     "plain",                  // "plain" or "newnote" (required)
  "children": ["h:abc123def456"],       // chunk ID array (required; [] if data inline)
  "data":     "",                       // inline content or "" when chunked (required)
  "size":     42,                       // file size in bytes (required)
  "mtime":    1707123456789,            // modification time, ms since epoch (required)
  "ctime":    1707123456789,            // creation time, ms since epoch (required)
  "datatype": "plain",                  // mirrors "type" (recommended)
  "eden":     {}                        // legacy reserved field — always include as {} (recommended)
}
```

### Field details

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | string | yes | Lowercase normalized path; see ID conventions |
| `_rev` | string | CouchDB managed | Set by CouchDB on PUT; include on updates |
| `path` | string | yes | Original-case path as stored in the vault |
| `type` | `"plain"` \| `"newnote"` | yes | Both mean "file document". Use `"plain"` for new writes |
| `data` | string | yes | File content when not chunked; `""` when `children` is used |
| `children` | string[] | yes | Array of `h:<hash>` chunk IDs. Use `[]` for small inline files |
| `size` | number | yes | Byte length of the original file content |
| `mtime` | number | yes | Last-modified timestamp in **milliseconds** since Unix epoch |
| `ctime` | number | yes | Creation timestamp in **milliseconds** since Unix epoch |
| `datatype` | `"plain"` \| `"newnote"` | recommended | Should mirror `type` |
| `deleted` | boolean | no | Soft-delete flag. `true` = file is deleted but tombstone retained |
| `eden` | object | recommended | Always `{}` — legacy field, must be present for compatibility |
| `_deleted` | boolean | CouchDB | Hard-delete / tombstone. Set `true` to fully remove from active DB |
| `_conflicts` | string[] | CouchDB | Native conflict tracking; managed by PouchDB/CouchDB |

---

## Chunk (Leaf) Documents

When a file is large, its content is split into chunks. Each chunk is a separate CouchDB document.

```jsonc
{
  "_id":  "h:abc123def456",   // "h:" + alphanumeric hash
  "type": "leaf",
  "data": "# Note content here\n\nSome more text..."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | string | yes | `h:` + alphanumeric hash of content |
| `type` | `"leaf"` | yes | Identifies this as a chunk |
| `data` | string | yes | The raw chunk content (plain text or base64 for binary) |

**Chunks are immutable.** The same content always produces the same ID. Do not update an existing chunk document — create new chunks with new IDs if content changes.

Clients detect chunks via `isChunk(_id)`, which checks for the `h:` prefix. Chunks bypass the normal note-processing pipeline and are stored directly.

---

## Chunking Algorithm

### Hash algorithms

LiveSync supports multiple hash algorithms, selectable per-database. The default for new installations is typically `xxhash64`. The `hashAlg` setting controls which is used:

| Setting value | Algorithm | Notes |
|---|---|---|
| `""` (empty) | Legacy algorithm | SHA-1 based, older installations |
| `"xxhash32"` | xxHash 32-bit | Fast; lower collision resistance |
| `"xxhash64"` | xxHash 64-bit | Fastest; recommended |
| `"mixed-purejs"` | Pure-JS fallback | No WebAssembly required |
| `"sha1"` | SHA-1 | Slow fallback; no WebAssembly required |

> **Source:** `src/modules/features/SettingDialogue/PanePatches.ts:146–154`

The hash output is encoded as a lowercase hex string. The chunk `_id` is then `"h:" + hexHash`.

### When to chunk

Small files may be stored inline (content in the note document's `data` field, `children: []`). Large files are split. The exact size threshold is defined in the commonlib submodule (not directly visible in this repo since it is a git submodule), but the general rule observed in practice:

- **Files ≤ ~100 bytes** — typically stored inline.
- **Files > chunk threshold** — split into one or more chunk documents, `children` array populated, `data: ""` in note document.

External writers should follow the same principle: for small files use inline `data`; for larger files, split into chunks and reference them via `children`.

### Safe chunk ID generation (if you cannot use xxhash)

Because the `hashAlg` is configurable, an external writer that cannot easily run xxhash may use SHA-1 (the legacy algorithm) and format the ID as:

```
_id = "h:" + sha1hex(chunkContent)
```

This remains compatible as long as the same algorithm is used consistently. Do **not** use URL-unsafe characters in the hash output — SHA-1 hex output is safe.

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
  "data":    "",
  "children": [],
  "size":    0,
  "mtime":   1707123456789,
  "ctime":   1707123456789,
  "deleted": true              // <-- soft delete
}
```

**Behaviour:**
- The file is removed from the vault on all synced clients.
- The document is retained in CouchDB for conflict resolution and history.
- After `automaticallyDeleteMetadataOfDeletedFiles` days (a LiveSync setting), the soft-deleted document is automatically promoted to a hard delete.

> **Source:** `src/modules/essential/ModuleInitializerFile.ts:353–388`

### Mechanism 2 — Hard delete (CouchDB tombstone, `_deleted: true`)

A hard delete uses CouchDB's native tombstone mechanism. After this, the document only exists as a tombstone and is eventually purged during compaction.

```jsonc
{
  "_id":      "folder/my note.md",
  "_rev":     "3-def...",
  "_deleted": true
}
```

**Behaviour:**
- Propagates to clients via the `_changes` feed as a deletion event.
- LiveSync checks both flags simultaneously:
  ```typescript
  const isDeleted = doc._deleted === true || ("deleted" in doc && doc.deleted === true);
  ```
- A hard-deleted document produces `data: ""` when gathered for storage application.

> **Source:** `src/modules/core/ReplicateResultProcessor.ts:403–406`

### Recommended delete procedure for external writers

To reliably propagate a deletion:

1. **Fetch** the current document (to get the latest `_rev`).
2. **PUT** an updated document with `"deleted": true` (soft delete), keeping all required fields.
3. Do **not** set `_deleted: true` directly from external tools unless you intend a permanent hard delete with no recovery window.

```jsonc
// Step 2: soft-delete PUT
{
  "_id":     "folder/my note.md",
  "_rev":    "<current_rev>",       // must match latest revision
  "path":    "Folder/My Note.md",
  "type":    "plain",
  "data":    "",
  "children": [],
  "size":    0,
  "mtime":   1707999999999,         // update mtime to now
  "ctime":   1707123456789,
  "deleted": true
}
```

> **Why toggling `deleted: false → true` may not work:** If the `_rev` is stale, CouchDB will return a 409 Conflict. Always fetch the current document first to get the latest `_rev`.

---

## Special / System Documents

These documents are managed exclusively by LiveSync and must not be created or modified by external tools.

| Document ID | Purpose |
|---|---|
| `SYNCINFO_ID` (a fixed string constant in the lib) | Tracks sync state between devices |
| Any ID starting with `_design` | CouchDB design documents for views/indexes |
| Documents with `type: "versioninfo"` | Protocol version negotiation; LiveSync stops replicating if remote `version > VER` |
| `MILESTONE_DOCID` | Migration milestone tracking |

When LiveSync receives a document from the `_changes` feed, it classifies it in this order:

1. If `isChunk(_id)` → process as leaf (chunk).
2. If `type == "versioninfo"` → version check.
3. If `_id == SYNCINFO_ID` or `_id.startsWith("_design")` → skip.
4. Otherwise → process as a note document.

> **Source:** `src/modules/core/ReplicateResultProcessor.ts:188–218`

---

## Internal & Config-Sync Documents

### Hidden / internal Obsidian files (`i:` prefix)

Files inside `.obsidian/` are stored with the `ICHeader` prefix (`i:`):

```
_id = "i:" + lowercase(relativePath)
```

These are only synced if the user has enabled **"Sync hidden files"** in LiveSync settings. Do not write to these unless intentionally managing Obsidian configuration.

### Plugin/customization sync documents (`x:` prefix)

Managed by LiveSync's customization-sync feature (`ICXHeader` = `x:`). Structure:

```
_id = "x:<term>/<category>/<filename>"
```

Where `<term>` is a device/vault identifier, `<category>` is the plugin category (e.g. `plugins`, `themes`, `snippets`), and `<filename>` is the file within that category.

### Plugin data documents (`type: "plugin"`)

```jsonc
{
  "_id":             "x:deviceName/plugins/my-plugin.md",
  "type":            "plugin",
  "deviceVaultName": "MyVault",
  "mtime":           1707123456789,
  "manifest":        { ... },
  "mainJs":          "...",
  "manifestJson":    "...",
  "styleCss":        "...",
  "dataJson":        "..."    // may be encrypted
}
```

---

## Sync & Replication Protocol

### How LiveSync watches for changes

LiveSync uses PouchDB's replication to a remote CouchDB. It watches the `_changes` feed with `include_docs: true`. Incoming changes are batched via `enqueueAll()` and processed with a semaphore (max 10 concurrent).

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

If the same `_id` is queued multiple times before processing, LiveSync replaces the earlier entry with the newer one **only if the deletion state is the same** (`isDeletedBefore === isDeletedNow`). A change from non-deleted to deleted (or vice versa) is always kept separately.

> **Source:** `src/modules/core/ReplicateResultProcessor.ts:236–265`

### Staleness check

Before applying a document to local storage, LiveSync checks whether the incoming `_rev` is still the latest. If a newer revision exists locally, the change is skipped (unless conflicts are present).

> **Source:** `src/modules/core/ReplicateResultProcessor.ts:444–468`

### Filters applied to incoming documents

LiveSync silently skips documents that fail any of these checks:

| Check | Notes |
|---|---|
| `isFileSizeTooLarge(size)` | Files over the configured size limit |
| `isValidPath(path)` | Path must be valid for the current OS |
| `isTargetFile(path)` | Must match vault sync filters |
| `mtime > maxMTimeForReflectEvents` | Used during remediation mode |

---

## Conflict Resolution

### Detection

Conflicts are detected via PouchDB's `_conflicts` array. Any document with a non-empty `_conflicts` array is re-processed even if its `_rev` matches the local copy.

### Auto-resolution strategies

1. **Identical content** — If both conflicting revisions have the same `data` and same `deleted` flag, the one with the **newer `mtime`** wins.
2. **Mergeable text** — LiveSync uses `diff-match-patch` to attempt a 3-way merge of plain-text files.
3. **Binary files** — Always resolved by **newest `mtime`**.
4. **`resolveConflictsByNewerFile` setting** — When enabled, always picks the newer revision regardless of content.

> **Source:** `src/modules/coreFeatures/ModuleConflictResolver.ts:66–127`

### Manual resolution

If auto-merge fails, the user is prompted to choose a revision. The losing revision is deleted with `deleteRevisionFromDB()`.

### Implication for external writers

- Always **GET before PUT** to obtain the current `_rev`.
- Do not write the same `_id` from multiple concurrent processes without coordination — this will create CouchDB conflicts that clients must resolve.
- If a 409 is returned, re-fetch and retry.

---

## End-to-End Encryption & Path Obfuscation

LiveSync supports optional E2EE. When enabled:

- Document `_id` values are **encrypted/obfuscated** using the user's passphrase — they no longer look like file paths.
- `data` fields in note documents and chunk documents are encrypted.
- External tools **cannot** interoperate with E2EE-enabled databases without implementing the same encryption scheme (AES-GCM via the Web Crypto API, as implemented in the commonlib).

**If your integration targets an E2EE-enabled database, this specification does not apply in its current form.** Check whether the user has `encrypt` and/or `passphrase` set in LiveSync settings. A practical signal: if document `_id` values look like random hex strings rather than file paths, E2EE is active.

Similarly, **path obfuscation** (`obfuscatePassphrase`) replaces the path-based `_id` with an HMAC of the path. The `path` field inside the document remains unencrypted (if E2EE is not also enabled), but the `_id` is opaque to external observers.

---

## Field Reference

### Complete note document schema

```typescript
interface NoteDocument {
  // CouchDB / PouchDB managed
  _id:        string;           // lowercase normalized path
  _rev?:      string;           // must be included on updates
  _deleted?:  boolean;          // CouchDB tombstone; omit on normal writes

  // Required LiveSync fields
  path:       string;           // original-case path
  type:       "plain" | "newnote";
  data:       string;           // file content (inline) or "" (if chunked)
  children:   string[];         // ["h:<hash>", ...] or []
  size:       number;           // bytes
  mtime:      number;           // milliseconds since epoch
  ctime:      number;           // milliseconds since epoch

  // Recommended
  datatype?:  "plain" | "newnote";  // mirrors type
  eden?:      {};               // always {} — legacy field

  // Optional state
  deleted?:   boolean;          // soft-delete flag

  // PouchDB native
  _conflicts?: string[];        // conflict revision IDs (read-only)
}
```

### Complete chunk (leaf) schema

```typescript
interface ChunkDocument {
  _id:      string;   // "h:" + alphanumeric hash
  type:     "leaf";
  data:     string;   // chunk content (plain text or base64 binary)
  _deleted?: boolean; // set true to purge chunk
}
```

---

## Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Document in CouchDB but not appearing in Obsidian | `_id` has uppercase letters | Lowercase the `_id`; keep original case in `path` |
| `"Failed to read file: Possibly unprocessed or missing"` | `children` references a chunk that doesn't exist yet | Write all chunk documents **before** writing the note document |
| `"No chunks were found for the following IDs: h:+..."` | Chunk `_id` contains URL-unsafe characters (`+`, `/`, `=`) | Use only alphanumeric characters in chunk IDs / hashes |
| Delete not propagating to clients | `deleted: false` set, or `_rev` is stale | GET current doc, then PUT with `deleted: true` and fresh `_rev` |
| 409 Conflict on write | Writing without current `_rev` | Always GET before PUT to obtain current `_rev` |
| Documents silently ignored | `path` is invalid for the client's OS | Avoid characters forbidden on Windows (`<>:"/\|?*`) for cross-platform vaults |
| Binary file not rendering | `data` not base64-encoded | Binary content must be base64 encoded in the `data` field |

---

## Minimal Working Examples

### Create a new note (small file, inline content)

```javascript
const doc = {
  _id:      "mynote.md",           // lowercase
  path:     "MyNote.md",           // original case
  type:     "plain",
  data:     "# Hello World\n",
  children: [],
  size:     16,
  mtime:    Date.now(),
  ctime:    Date.now(),
  datatype: "plain",
  eden:     {}
};
await db.put(doc);
```

### Create a note with chunks (large file)

```javascript
// 1. Create chunk first
const chunkContent = "...file content...";
const chunkHash = xxhash64(chunkContent); // alphanumeric hex
const chunk = {
  _id:  `h:${chunkHash}`,
  type: "leaf",
  data: chunkContent
};
await db.put(chunk);

// 2. Create note document referencing the chunk
const note = {
  _id:      "folder/large-note.md",
  path:     "Folder/Large Note.md",
  type:     "plain",
  data:     "",
  children: [`h:${chunkHash}`],
  size:     chunkContent.length,
  mtime:    Date.now(),
  ctime:    Date.now(),
  datatype: "plain",
  eden:     {}
};
await db.put(note);
```

### Soft-delete a note

```javascript
// 1. Fetch current revision
const existing = await db.get("folder/large-note.md");

// 2. Put with deleted: true
await db.put({
  ...existing,
  deleted: true,
  mtime:   Date.now(),
  data:    "",
  children: []
});
```

### Update an existing note

```javascript
// 1. Fetch current document
const existing = await db.get("folder/large-note.md");

// 2. Modify and PUT (must include _rev)
await db.put({
  ...existing,
  data:  "new inline content",
  size:  18,
  mtime: Date.now()
});
```

---

*This specification was derived from source-code analysis of obsidian-livesync commit `bf556bd` and community findings documented in issue [vrtmrz/obsidian-livesync#795](https://github.com/vrtmrz/obsidian-livesync/issues/795).*
