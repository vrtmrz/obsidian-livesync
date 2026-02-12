# Data Structures of Self-Hosted LiveSync
## Overview

Self-hosted LiveSync uses the following types of documents:

- Metadata
    - Legacy Metadata
    - Binary Metadata
    - Plain Metadata
- Chunk
- Versioning
- Synchronise Information
- Synchronise Parameters
- Milestone Information

## Description of Each Data Structure

All documents inherit from the `DatabaseEntry` interface. This is necessary for conflict resolution and deletion flags.

```ts
export interface DatabaseEntry {
    _id: DocumentID;
    _rev?: string;
    _deleted?: boolean;
}
```

### Versioning Document

This document stores version information for Self-hosted LiveSync.
The ID is fixed as `obsydian_livesync_version` [VERSIONING_DOCID]. Yes, the typo has become a curse.
When Self-hosted LiveSync detects changes to this document via Replication, it reads the version information and checks compatibility.
In that case, if there are major changes, synchronisation may be stopped.
Please refer to negotiation.ts.

### Synchronise Information Document

This document stores information that should be verified in synchronisation settings.
The ID is fixed as `syncinfo` [SYNCINFO_ID].
The information stored in this document is only the conditions necessary for synchronisation to succeed, and as of v0.25.43, only a random string is stored.
This document is only used during rebuilds from the settings screen for CouchDB-based synchronisation, making it like an appendix. It may be removed in the future.

### Synchronise Parameters Document

This document stores synchronisation parameters.
Synchronisation parameters include the protocol version and salt used for encryption, but do not include chunking settings.

The ID is fixed as `_local/obsidian_livesync_sync_parameters` [DOCID_SYNC_PARAMETERS] or `_obsidian_livesync_journal_sync_parameters.json` [DOCID_JOURNAL_SYNC_PARAMETERS].

This document exists only on the remote and not locally.
This document stores the following information.
It is read each time before connecting and is used to verify that E2EE settings match.
This mismatch cannot be ignored and synchronisation will be stopped.

```ts
export interface SyncParameters extends DatabaseEntry {
    _id: typeof DOCID_SYNC_PARAMETERS;
    type: (typeof EntryTypes)["SYNC_PARAMETERS"];
    protocolVersion: ProtocolVersion;
    pbkdf2salt: string;
}
```

#### protocolVersion

This field indicates the protocol version used by the remote. Mostly, this value should be `2` (ProtocolVersions.ADVANCED_E2EE), which indicates safer E2EE support.

#### pbkdf2salt

This field stores the salt used for PBKDF2 key derivation on the remote. This salt and the passphrase provides E2EE encryption keys.

### Milestone Information Document

This document stores information about how the remote accepts and recognises clients.
The ID is fixed as `_local/obsidian_livesync_milestone` [MILESTONE_DOCID].
This document exists only on the remote and not locally.
This document is used to indicate synchronisation progress and includes the version range of accepted chunks for each node and adjustment values for each node.
Tweak Mismatched is determined based on the information in this document.

For details, please refer to LiveSyncReplicator.ts, LiveSyncJournalReplicator.ts, and LiveSyncDBFunctions.ts.

```ts
export interface EntryMilestoneInfo extends DatabaseEntry {
    _id: typeof MILESTONE_DOCID;
    type: EntryTypes["MILESTONE_INFO"];
    created: number;
    accepted_nodes: string[];
    node_info: { [key: NodeKey]: NodeData };
    locked: boolean;
    cleaned?: boolean;
    node_chunk_info: { [key: NodeKey]: ChunkVersionRange };
    tweak_values: { [key: NodeKey]: TweakValues };
}
```

### locked

If the remote has been requested to lock out from any client, this is set to true.
When set to true, clients will stop synchronisation unless they are included in accepted_nodes.

### cleaned

If the remote has been cleaned up from any client, this is set to true.
In this case, clients will stop synchronisation as they need to rebuild again.

### Metadata Document

Metadata documents store metadata for Obsidian notes.

```ts
export interface MetadataDocument extends DatabaseEntry {
    _id: DocumentID;
    ctime: number;
    mtime: number;
    size: number;
    deleted?: boolean;
    eden: Record<string, EdenChunk>; // Obsolete
    path: FilePathWithPrefix;
    children: string[];
    type: EntryTypes["NOTE_LEGACY" | "NOTE_BINARY" | "NOTE_PLAIN"];
}
```

### type

This field indicates the type of Metadata document.
By convention, Self-hosted LiveSync does not save the mime type of the file, but distinguishes them with this field. Please note this.
Possible values are as follows:

- NOTE_LEGACY: Legacy metadata document
    - Please do not use
- NOTE_BINARY: Binary metadata document (newnote)
- NOTE_PLAIN: Plain metadata document (plain)

#### children

This field stores an array of Chunk Document IDs.

#### \_id, path

\_id is generated based on the path of the Obsidian note.

- If the path starts with `_`, it is converted to `/_` for convenience.
- If Case Sensitive is disabled, it is converted to lowercase.

When Obfuscation is enabled, the path field contains `f:{obfuscated path}`.
The path field stores the path as is. However, when Obfuscation is enabled, the obfuscated path is stored.

When Property Encryption is enabled, the path field stores all properties including children, mtime, ctime, and size in an encrypted state. Please refer to encryption.ts.

### Chunk Document

```ts
export type EntryLeaf = DatabaseEntry & {
    _id: DocumentID;
    type: EntryTypes["CHUNK"];
    data: string;
};
```

Chunk documents store parts of note content.

- The type field is always `[CHUNK]`, `leaf`.
- The data field stores the chunk content.
- The \_id field is generated based on a hash of the content and the passphrase.

Hash functions used include xxHash and SHA-1, depending on settings.
Chunking methods used include Contextual Chunking and Rabin-Karp Chunking, depending on settings.
