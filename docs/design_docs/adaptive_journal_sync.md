# [PLANNING] Adaptive Journal Sync

> [!NOTE]
> This document is an exploratory developer design. It is not a design freeze, release commitment, migration
> instruction, or statement of current user-visible behaviour. The existing opaque Journal pack protocol remains the
> implementation baseline while this proposal is evaluated.

## Summary

Adaptive Journal Sync would separate lightweight Metadata events from Chunk delivery while preserving one common
Journal replication contract across different remote capabilities.

The logical model would always treat Chunks as content-addressable, immutable values. The physical representation would
adapt to the remote:

- a batch-capable database such as PostgreSQL exposed through PostgREST could store one independently framed Chunk
  record per immutable row and answer multi-key requests through one RPC; and
- an object-shaped remote such as S3-compatible Object Storage or WebDAV could aggregate Chunks into immutable packs,
  then resolve Chunk identifiers through an append-only, versioned catalogue.

This proposal deliberately separates common semantics from common physical layout. A remote does not need to store
Chunks in the same shape as another remote, but every implementation must provide the same batched availability,
storage, retrieval, publication, and failure guarantees.

## Context

Self-hosted LiveSync already separates each file into one Metadata document and multiple Chunk documents. Metadata
contains file properties and Chunk references; it does not contain raw file content.

The current Journal Replicator serialises Metadata and Chunk document changes into the same compressed and optionally
encrypted Journal pack. `IJournalStorage` then transports each pack as an opaque key and byte sequence. This design is a
useful compatibility baseline because S3-compatible Object Storage, WebDAV, and PostgREST exercise the same Journal
logic.

The common opaque representation also prevents a storage adapter from making Chunk-specific decisions. By the time an
adapter receives a pack, Metadata and Chunks have already been combined, compressed, and encrypted. PostgREST can
provide indexed Journal listing, but it cannot use native batched Chunk lookup or relational transactions at this
boundary.

Adaptive Journal Sync proposes a domain-level repository boundary above physical object storage.

## Existing implementation seams

The proposal can remain inside Journal Sync and reuse maintained boundaries rather than adding another top-level
replicator:

- `JournalSyncCore` already reads exact PouchDB revisions, serialises Journal batches, advances a send checkpoint only
  after publication, stores received Chunks before Metadata, and applies Metadata with its supplied revision history.
- `LayeredChunkManager` already provides read and write middleware around the local Chunk database. Its dormant
  `HotPackLayer` is an implementation seam for a pack-backed Chunk source, not a requirement to revive the earlier
  mutable hot-log design.
- `ChunkFetcher` already collects missing Chunk IDs into bounded groups, owns request claims and terminal conditions,
  validates returned Chunks, persists them locally, and notifies waiters. Adaptive Journal Sync should implement the
  Journal `fetchRemoteChunks` producer at that boundary rather than introduce another waiting mechanism.
- `putDBEntry` already creates Chunks before Metadata inside the Chunk manager transaction boundary.

These seams establish where the new repository composes. They do not make CouchDB, P2P, or their connection settings
aware of Adaptive Journal Sync.

## Relationship to existing designs

This proposal builds on, rather than silently replaces, the following documents:

- [The Journal Replicator 2nd Edition](../design_docs_of_journalsync_2nd.md) defines the current streaming pipeline and
  `IJournalStorage` boundary.
- [The design intent explanation for using metadata and chunks](intention_of_chunks.md) records why Metadata and Chunks
  are separate and why Chunks are content-addressable.
- [Tiered Chunk Storage with Live Compaction](tired_chunk_pack.md) and
  [Tiered Chunk Storage for Bucket Sync](tired_chunk_pack_bucket.md) establish the hot/cold and LSM-tree motivation.
- [Chunk Aggregation by Prefix](chunk_aggregation_by_prefix.md) is withdrawn, but records the risks of mutable shared
  index documents and write-conflict retry loops.
- [Chunk Retrieval and Waiting](chunk_retrieval_and_waiting.md) defines the current delivery and terminal-condition
  contract which any new direct Chunk source must extend deliberately.

Adaptive Journal Sync refines the earlier tiered proposals by replacing mutable per-client hot logs and shared mutable
index documents with immutable Level 0 segments, append-only catalogue deltas, and periodic catalogue snapshots.

## Goals

- Keep Metadata and raw file content separate throughout remote publication.
- Preserve logical content-addressable storage for Chunks.
- Bound network requests by batches or packs rather than by individual Chunk count.
- Use native multi-key RPCs and transactions where a remote provides them.
- Use immutable pack files and catalogue records where a remote provides only object operations.
- Keep ordinary multi-writer publication append-only and free from a central mutable write bottleneck.
- Publish referenced Chunks before publishing Metadata which makes those references visible.
- Retain end-to-end encryption and document any metadata or equality leakage introduced by indexed Chunk lookup.
- Allow the current opaque Journal protocol and the proposed protocol to coexist behind an explicit version boundary.
- Make every derived index and cache reconstructible from authoritative remote records.

## Non-goals

- Replacing Metadata with a server-readable relational file schema.
- Storing raw file content inside Metadata rows or events.
- Requiring every remote to expose the same physical layout.
- Guaranteeing that the same logical Chunk has exactly one physical copy at every moment.
- Introducing an implicit migration or rebuild for existing Journal remotes.
- Making Garbage Collection safe without an explicit reachability, retention, and device-progress policy.
- Committing this design to a release before correctness, privacy, and performance gates have passed.

## Terminology

### Logical Chunk

An immutable content value identified by a Chunk ID. If bytes change, the result is a new logical Chunk with a new ID.
An existing logical Chunk is never updated in place.

### Remote Chunk key

A repository-scoped, 32-byte address derived locally from the exact logical Chunk ID after the repository manifest has
been accepted. It is a query and object-routing identifier, not an encryption key. A client can reproduce it when
needed, so it does not persist a secret Chunk-ID-to-remote-key mapping. The same logical Chunk ID always derives the
same Remote Chunk key within one repository namespace.

### Native CAS

A remote representation in which one logical Chunk maps to one insert-only value addressable by an opaque Chunk key.
PostgreSQL is the initial candidate because it can answer `hasMany`, `getMany`, and `putMany` through bounded batch RPCs.

### Chunk pack

An immutable physical object containing one or more independently verifiable Chunk records. Encrypted mode
authenticates and encrypts each record; unencrypted mode provides corruption detection without claiming authentication
against a hostile remote. A pack is a request-amortisation and compaction unit, not the logical identity of its Chunks.

### Catalogue

The reconstructible mapping from opaque remote Chunk keys to one or more physical pack locations. Its authoritative
object-storage representation consists of immutable snapshots and append-only deltas. A local in-memory or persistent
catalogue may be mutable because it is derived state.

### Metadata batch

An immutable group of Metadata revision events. It refers to logical Chunk IDs and contains no raw Chunk content.

### Commit manifest

The final publication record for a Metadata batch. A reader ignores an incomplete batch until its commit manifest is
visible and valid.

### Writer stream

One append-only sequence owned by a stable host ID and a writer epoch. The writer epoch is a random, collision-resistant
identifier persisted with the repository binding. It is not a wall-clock timestamp. A host creates a new writer epoch
after losing or deliberately replacing its local send state.

## Required invariants

1. Metadata contains Chunk references, never raw file content.
2. A logical Chunk ID identifies immutable bytes.
3. A committed Metadata reference is not published before at least one valid remote source for that Chunk is durable.
4. Ordinary writers create immutable records. They do not edit an existing pack, catalogue snapshot, or catalogue
   delta.
5. A retry may create a duplicate physical Chunk or pack, but it must not create two logical meanings for one Chunk ID.
6. A receiver validates identity and, in encrypted mode, authenticated encryption before accepting a Chunk.
7. A derived catalogue, cache, or PostgreSQL materialised index can be discarded and reconstructed.
8. Repacking does not require Metadata revision changes because Metadata refers to logical Chunk IDs rather than pack
   locations.
9. Remote reset, protocol migration, compaction, retirement, and deletion remain explicit protected operations.
10. The protocol must define a bounded completion or failure condition for each requested Chunk batch.
11. Each writer stream publishes a dense monotonic sequence and never publishes sequence `N + 1` before sequence `N`
    has been verified as committed.
12. A receiver records one frontier per writer stream and never treats a global wall-clock or lexicographic maximum as
    proof that all earlier work from every writer has been observed.

## Proposed repository boundary

`IJournalStorage` remains useful as the current opaque-object transport. Adaptive Journal Sync would introduce a
higher-level repository composition:

```ts
interface JournalEventStore {
    appendMetadataBatch(batch: StoredMetadataBatch): Promise<BatchCommit>;
    listMetadataBatches(after: BatchCursor, limit: number): Promise<StoredMetadataBatch[]>;
}

interface ChunkStore {
    capabilities(): ChunkStoreCapabilities;
    hasMany(ids: readonly RemoteChunkKey[]): Promise<ChunkAvailability>;
    putMany(chunks: readonly StoredChunkRecord[]): Promise<ChunkPublication>;
    getMany(ids: readonly RemoteChunkKey[]): Promise<ChunkResult>;
}

interface AdaptiveJournalRepository {
    events: JournalEventStore;
    chunks: ChunkStore;
}
```

The interface is batched even when the physical remote lacks a native batch operation. The implementation owns request
planning and must not make the caller loop over one network request per Chunk.

The current opaque `IJournalStorage` return values deliberately collapse several transport outcomes into `false` or an
empty list. Adaptive publication cannot use those values to decide that an object is absent or that an empty repository
is safe to initialise. The adaptive repository therefore needs typed outcomes at its correctness boundary:

```ts
type RemoteRead<T> =
    | { status: "found"; value: T; identity?: string }
    | { status: "missing" }
    | { status: "failed"; failure: RemoteFailure };

type ImmutableCreate =
    | { status: "created"; identity?: string }
    | { status: "already-exists"; identity?: string }
    | { status: "failed"; failure: RemoteFailure };

type ListingPage<T> =
    | { status: "page"; values: readonly T[]; next: string }
    | { status: "complete"; values: readonly T[] }
    | { status: "failed"; failure: RemoteFailure };

type RemoteFailure = {
    category:
        | "authentication"
        | "permission"
        | "rate-limited"
        | "unavailable"
        | "invalid-response"
        | "unknown";
    retry: "never" | "later" | "verify-first";
};
```

Authentication failure, permission denial, timeout, malformed response, server failure, and an explicitly missing
object remain distinguishable. An adapter may implement these operations by HTTP, SQL RPC, an SDK, or another remote
mechanism. The repository contract defines the observable result, not the provider or wire method.

`missing` and `already-exists` are expected outcomes rather than failures. A mutation which loses its response is
`unknown` with `verify-first`: the caller reads the exact immutable key before deciding whether to retry. A read-only
timeout may be retried later, while authentication, permission, and invalid-response failures require intervention
rather than an existence assumption.

Capability selection should describe semantics rather than provider names. Candidate capabilities include:

- bounded native multi-key lookup;
- bounded native multi-value read and write;
- atomic batch publication;
- conditional object writes;
- byte-range reads;
- inexpensive ordered listing; and
- server-side immutable CAS insertion.

The capability report does not benchmark the deployment or recommend a retrieval policy. The initial object-pack
implementation exposes a user preference of `whole-pack` or `range`. `range` is available only when the endpoint probe
has confirmed byte-range semantics; `whole-pack` is the portable default. An automatic policy may be considered later
without changing repository correctness.

The recommended v1 interpretation treats `range` as a performance preference, not a correctness requirement. If a
previously capable endpoint stops honouring Range requests, normal synchronisation reports the capability change and
falls back to `whole-pack`. A separate strict diagnostic may fail instead, but loss of an optional optimisation should
not make readable data unavailable.

### Repository initialisation

An adaptive remote starts with one immutable repository manifest created through `putIfAbsent` semantics. The
recommended v1 manifest owns the Adaptive Security Seed rather than creating an empty Sync Parameters object and
updating its salt in a second operation:

```json
{
  "chunkKeyMode": "hmac-sha256",
  "cipherSuite": "aes-256-gcm",
  "format": "adaptive-journal",
  "formatVersion": 1,
  "manifestAuth": "<authentication over the other canonical fields>",
  "passwordKdf": {
    "iterations": 310000,
    "name": "pbkdf2-hmac-sha256",
    "outputBytes": 32
  },
  "recordKdf": "hkdf-sha256",
  "repositoryId": "<32 random bytes, base64url>",
  "requiredCapabilities": [
    "binary-fidelity",
    "complete-listing",
    "conditional-create",
    "delete-visibility",
    "read-after-write"
  ],
  "securitySeed": "<32 random bytes, base64url>"
}
```

The public manifest uses a restricted canonical JSON representation: UTF-8, lexicographically sorted object keys,
integers rather than floating-point values, and no insignificant whitespace. `manifestAuth` is calculated over the
canonical bytes with that field omitted. This makes the manifest independently reproducible without making ordinary
control records depend on JSON property order.

`requiredCapabilities` declares protocol preconditions which the selected adapter must verify before the first write.
It is not a claim made by the server and is not accepted without an adapter check or, for WebDAV, the empirical safety
probe. Optional byte-range support is deliberately absent from this list.

The v1 encrypted and unencrypted parameter tuples are fixed format constants rather than server-selected negotiation.
For encrypted mode this includes the KDF names, iteration count, output length, Chunk-key mode, and cipher suite shown
above. Unsupported or weaker values fail closed and require a later format version. The trusted local connection
profile also records whether encryption is expected; an encrypted profile never accepts a manifest which switches to
the unencrypted digest mode.

Repository opening receives an explicit local intent of `create-new` or `attach-existing`. This is an operation
precondition, not a value negotiated with the remote. Initialisation proceeds as follows:

1. Read the manifest with an outcome which distinguishes `missing` from failure.
2. Under `create-new`, treat an already present manifest as `repository-already-exists`; do not attach or overwrite
   implicitly.
3. Under `attach-existing`, treat `missing` as a repository error and create nothing.
4. Under `create-new`, if the manifest is missing, verify the required adapter capabilities, generate `repositoryId` and
   `securitySeed` locally, derive the secure repository keys when applicable, calculate `manifestAuth`, and create the
   candidate's exact bytes conditionally.
5. If another concurrent creator wins, discard the complete local candidate, read the winner, derive secure keys when
   applicable, and verify `manifestAuth`.
6. If create has an unknown outcome, read and compare the exact key before retrying. Never merge fields or overwrite the
   manifest.
7. Pin the accepted `repositoryId` in the local repository binding. An existing binding must match it, even when a
   substituted manifest has a valid HMAC under a reused passphrase.
8. Verify required adapter capabilities before the first writer registration or other Adaptive write in this client
   session.
9. Initialise a device-local writer epoch only after the repository manifest has been accepted.

The resulting state decisions are:

| Local expectation | Remote result | Decision |
| --- | --- | --- |
| `create-new`, no binding | Explicitly missing | Conditionally create one candidate |
| `create-new`, no binding | Found | Stop with `repository-already-exists` |
| `attach-existing`, no binding | Found and authenticated as expected | Pin and open |
| `attach-existing`, no binding | Missing | Stop without writing |
| Existing pinned binding | Same authenticated repository ID | Open |
| Existing pinned binding | Missing or different repository ID | Stop for explicit reset or rebind |
| Any state | Authentication, permission, timeout, or invalid response | Stop without treating it as missing |

Before the first conditional manifest create, the client durably stores the exact candidate bytes and digest as a small
`pendingInitialisation` value. After a restart it resolves that value before starting another create: explicit missing
retries the same candidate, an exact remote digest confirms success, and a different valid manifest means that another
creator won and the complete local candidate is discarded. Pinning the accepted repository ID and clearing
`pendingInitialisation` form one local atomic update.

The first device therefore generates the random public inputs locally, but the conditionally created manifest decides
which inputs belong to the repository. Additional devices do not copy a device-generated identity key: they derive the
same secure role keys, or the same public identifiers, locally from the accepted manifest. A Setup URI exported from an
accepted binding should also carry the expected, non-secret `repositoryId`; `attach-existing` compares it before any
write.

The existing opaque Journal Sync Parameters object remains the compatibility mechanism for `opaque-v1`. An
`adaptive-v1` repository uses the single manifest above and does not inherit the current empty-object-then-salt-update
race. A fresh adaptive repository, including an ordinary migration from the opaque layout, generates a new Security
Seed by default. Carrying an existing seed would require an explicit migration format and is not implicit compatibility
behaviour.

The existing opaque adapters do not yet guarantee this initialisation race. S3-compatible storage needs an
`If-None-Match` condition, WebDAV needs empirically verified `If-None-Match: *` behaviour, and PostgREST needs an
insert-only unique operation rather than an upsert. Adaptive mode must not become writable until its adapter provides
that guarantee.

## Physical strategies

### Native batch CAS

PostgREST can expose a Vault-scoped, row-level-security-protected Chunk table:

```sql
create table chunks (
    vault_id text not null,
    repository_id bytea not null check (octet_length(repository_id) = 32),
    chunk_key bytea not null check (octet_length(chunk_key) = 32),
    record_frame bytea not null,
    frame_digest bytea not null check (octet_length(frame_digest) = 32),
    size_bytes bigint generated always as (octet_length(record_frame)::bigint) stored,
    created_at timestamptz not null default statement_timestamp(),
    primary key (vault_id, repository_id, chunk_key)
);
```

The corresponding writer and committed-Metadata rows can remain small and append-only:

```sql
create table writer_streams (
    vault_id text not null,
    repository_id bytea not null check (octet_length(repository_id) = 32),
    writer_stream_id bytea not null check (octet_length(writer_stream_id) = 32),
    descriptor_frame bytea not null,
    descriptor_digest bytea not null check (octet_length(descriptor_digest) = 32),
    created_at timestamptz not null default statement_timestamp(),
    primary key (vault_id, repository_id, writer_stream_id)
);

create table metadata_batches (
    vault_id text not null,
    repository_id bytea not null check (octet_length(repository_id) = 32),
    writer_stream_id bytea not null check (octet_length(writer_stream_id) = 32),
    sequence bigint not null check (sequence > 0),
    metadata_frame bytea not null,
    metadata_digest bytea not null check (octet_length(metadata_digest) = 32),
    created_at timestamptz not null default statement_timestamp(),
    primary key (vault_id, repository_id, writer_stream_id, sequence),
    unique (vault_id, repository_id, writer_stream_id, sequence, metadata_digest),
    foreign key (vault_id, repository_id, writer_stream_id)
        references writer_streams (vault_id, repository_id, writer_stream_id)
);

create table journal_commits (
    vault_id text not null,
    repository_id bytea not null check (octet_length(repository_id) = 32),
    writer_stream_id bytea not null check (octet_length(writer_stream_id) = 32),
    sequence bigint not null check (sequence > 0),
    previous_commit_digest bytea null check (
        previous_commit_digest is null or octet_length(previous_commit_digest) = 32
    ),
    required_chunk_keys_digest bytea not null check (octet_length(required_chunk_keys_digest) = 32),
    metadata_digest bytea not null check (octet_length(metadata_digest) = 32),
    commit_frame bytea not null,
    commit_digest bytea not null check (octet_length(commit_digest) = 32),
    created_at timestamptz not null default statement_timestamp(),
    primary key (vault_id, repository_id, writer_stream_id, sequence),
    foreign key (vault_id, repository_id, writer_stream_id)
        references writer_streams (vault_id, repository_id, writer_stream_id),
    foreign key (vault_id, repository_id, writer_stream_id, sequence, metadata_digest)
        references metadata_batches (
            vault_id,
            repository_id,
            writer_stream_id,
            sequence,
            metadata_digest
        )
);
```

These definitions illustrate the semantic constraints rather than a ready migration: the packaged SQL must also install
row-level-security policies, immutable insert-only RPCs, grants, digest calculation, bounded queries, and indexes. The
RPC computes frame digests from supplied bytes, and a client recomputes them after reads.

`vault_id` is obtained from the authenticated JWT claim by the database policy or security-invoker RPC. It is not
trusted from a field supplied by the binary request.

The public API would use bounded RPCs rather than one ordinary REST request per row:

- `has_chunks(keys[])` returns a compact availability result;
- `get_chunks(keys[])` returns a framed or streamed binary batch;
- `put_chunks(keys[], bodies[])` inserts missing immutable rows and verifies existing identities; and
- `put_metadata_batch(...)` inserts one immutable, not-yet-visible Metadata row; and
- `commit_metadata_batch(...)` publishes that row only after its required Chunks are present.

The exact request limits must be byte-based as well as count-based. A request containing hundreds of small Chunks and a
request containing hundreds of large Chunks do not have equivalent memory or proxy cost.

PostgreSQL may maintain mutable derived indexes transactionally. The Chunk rows themselves remain immutable CAS values,
and any separately maintained operational index must be rebuildable from authoritative rows and batch commits.
`created_at` is diagnostic server time only. It is never a replication cursor, a cross-writer ordering source, or
evidence that a Chunk is safe to collect.

#### Recommended v1 PostgREST framing

The initial PostgREST experiment should continue the existing binary RPC approach rather than encode every `bytea` value
inside JSON. A bounded `application/octet-stream` argument and response use:

```text
BatchEnvelopeV1 :=
    magic[4]                 // "LSAB"
    formatVersion:u8
    operation:u8
    flags:u16be
    entryCount:u32be
    totalLength:u64be
    entries[entryCount]
```

Availability entries contain a 32-byte remote Chunk key. Put entries add a frame length and one complete
`RecordFrameV1`. Get responses add an explicit per-key `found` or `missing` status and include a frame only for `found`.
The request and response preserve input order so the client does not need a second key map.

The recommended operation and status codes are:

| Operation | Request entry | Response entry |
| --- | --- | --- |
| `0x01 HAS` | `remoteChunkKey[32]` | `status:u8`, where `0` is missing and `1` is present |
| `0x02 GET` | `remoteChunkKey[32]` | `status:u8`; found adds `frameDigest[32]`, `frameLength:u64be`, and `RecordFrameV1` |
| `0x03 PUT` | `remoteChunkKey[32]`, `frameDigest[32]`, `frameLength:u64be`, and `RecordFrameV1` | `status:u8`, where `0` is inserted, `1` is the exact existing frame, and `2` requires existing-frame validation |

`flags & 0x0001` marks a response; every other v1 batch flag is zero. Authentication, authorisation, malformed input,
server unavailability, and transaction failure remain typed RPC failures rather than per-entry Chunk statuses. A PUT
digest is an early framing check only: the server recomputes SHA-256 over the supplied frame.

The final Metadata publication uses a separate bounded `CommitEnvelopeV1`, because it has one writer identity and
sequence rather than homogeneous Chunk entries. It contains the repository ID, writer stream ID, sequence, nullable
previous commit digest, sorted unique required-key set and digest, Metadata logical key and digest, and exact commit
frame. Stage 0 fixtures freeze its field offsets before the SQL function is installed.

Every RPC enforces both an entry-count limit and a total-byte limit before allocating or concatenating a response. v1
does not claim unbounded streaming through PostgREST: the client pages large work into bounded binary RPCs. This avoids
JSON base64 or hexadecimal expansion while keeping PostgreSQL `bytea` materialisation explicit and measurable.
`totalLength` is the exact complete envelope length, including its fixed header, and the decoder rejects a mismatch.
Unsigned 64-bit lengths are parsed without conversion to a JavaScript `number` until the configured maximum has been
checked.

The RPC computes the SHA-256 frame digest from the supplied bytes rather than trusting a client assertion, and clients
recompute it after every read. `put_chunks` inserts missing rows and treats an exact existing frame digest as an
idempotent retry. If the key exists with a different frame digest, the RPC returns a per-key conflict rather than
replacing the row. Different random record salts mean that two honest clients can produce different valid frames for
the same logical Chunk, so the client must fetch, decrypt when applicable, and validate the existing frame against the
requested remote Chunk key. It then accepts an equivalent existing Chunk or reports corruption; the server does not
infer plaintext equality from a frame digest.

The transactional Metadata commit RPC verifies the required-key-set digest, checks all required Chunk and Metadata rows,
enforces the writer sequence and previous commit digest, and inserts only the final commit row. Unique constraints
provide idempotence for repository ID, writer stream, sequence, and remote Chunk key.

### Immutable pack CAS

S3-compatible Object Storage and WebDAV do not normally provide multi-key value retrieval. Storing one remote object per
Chunk would turn a missing set of 1,000 Chunks into as many as 1,000 existence requests and 1,000 value requests.
Parallel HTTP requests reduce elapsed time but do not remove request cost, connection pressure, or service charging.

The pack strategy groups newly published Chunks into immutable objects:

```text
packs/<pack-id>.bin
indexes/<pack-id>.idx
catalogue/deltas/<writer-stream>/<sequence>.delta
```

The pack index maps each opaque remote Chunk key to its complete frame offset, frame length, and integrity information.
The canonical retrieval path downloads a complete pack. A confirmed byte-range capability may instead retrieve selected
records when the user has chosen that policy. Both paths expose the same batched `getMany` result, and Range support is
not an Adaptive Journal safety requirement.

Transfer and local materialisation are separate choices. A client may cache one downloaded pack, extract only the
currently requested Chunks, and retain the indexed pack for later requests. It need not immediately write every
unrequested record into the local Chunk database. Conversely, Fast Setup or another dense read can materialise the
complete pack in one pass.

The pack must contain independently framed, compressed, and integrity-checked records. Encrypted mode encrypts and
authenticates each record independently. Whole-pack compression or whole-pack AEAD would make an isolated Range response
unusable. The verified index supplies the byte offsets needed for Range retrieval, while the complete-pack path
validates the same records.

#### Recommended v1 record envelope

Bulk data uses a small binary frame rather than JSON or a provider-specific row representation:

```text
RecordFrameV1 :=
    magic[4]                 // "LSAR"
    formatVersion:u8         // 1
    recordKind:u8
    flags:u16be
    publicHeaderLength:u32be
    payloadLength:u64be
    publicHeader[publicHeaderLength]
    payload[payloadLength]
```

The v1 record kinds and their provider-independent logical keys are:

| Code | Record kind | Canonical logical key | Encryption role |
| --- | --- | --- | --- |
| `0x01` | Chunk | `remoteChunkKey[32]` | `chunk-record` |
| `0x02` | Pack index | `packIdDigest[32]` | `pack-index` |
| `0x03` | Metadata batch | `writerStreamId[32] || sequence:u64be` | `metadata-record` |
| `0x04` | Catalogue delta | `writerStreamId[32] || sequence:u64be` | `catalogue-record` |
| `0x05` | Catalogue snapshot | `snapshotId[32]` | `catalogue-record` |
| `0x06` | Writer descriptor | `writerStreamId[32]` | `writer-record` |
| `0x07` | Commit | `writerStreamId[32] || sequence:u64be` | `commit-record` |

`snapshotId` is a random identifier generated before encoding; its exact frame digest is calculated afterwards. The
logical key is independent of the provider's physical object-name encoding. S3-compatible storage may use hierarchical
paths, WebDAV may use flat names, and PostgREST may use columns without changing record encryption or identity.

`flags & 0x0001` means encrypted, and every other v1 flag bit is zero. The flag must agree with the encryption mode
pinned in the local connection profile and repository manifest. The public header is exactly one of:

```text
EncryptedHeaderV1 :=
    codec:u8
    reserved[3]              // zero
    plaintextLength:u64be
    recordSalt[32]
    iv[12]

UnencryptedHeaderV1 :=
    codec:u8
    reserved[3]              // zero
    plaintextLength:u64be
    payloadDigest[32]
```

The corresponding `publicHeaderLength` values are 56 and 44 bytes. Codec `0x00` is no compression. Codec `0x01` is the
raw DEFLATE stream accepted by the maintained `fflate` `deflate` and `inflate` boundary; a writer uses it only when the
resulting payload is smaller. Valid encoders do not need to produce identical compressed bytes. Adding another codec
requires a later format version.

An encrypted record's payload is AES-256-GCM ciphertext with its 16-byte tag appended by the cipher operation. An
unencrypted record's payload is compressed or uncompressed plaintext, and `payloadDigest` is SHA-256 over those exact
stored bytes. That digest detects accidental damage but does not authenticate data against a hostile remote.

Numeric lengths are unsigned big-endian integers and every decoder applies explicit maximum values before allocating
memory. Reserved bytes and flag bits must be zero, unsupported record kinds, codecs, or modes fail closed, and the
declared public-header and payload lengths must equal the available bytes. The baseline v1 record, batch, and pack byte
ceilings must be frozen with Stage 0 fixtures before a writer is enabled; a local implementation may impose a lower
operational limit only if it reports the incompatibility instead of treating an oversized valid record as corruption.

In encrypted mode, AEAD additional authenticated data is:

```text
aad = canonicalBytes(
    "livesync/adaptive-journal/record-aad/v1",
    repositoryId[32],
    logicalKeyLength:u16be,
    logicalKey[logicalKeyLength],
    fixedRecordPrefix[20],
    publicHeader[publicHeaderLength]
)
```

The fixed record prefix already contains the magic, format version, record kind, flags, and both lengths. The logical
key is supplied by the PostgreSQL row, verified pack index, or decoded provider-independent control-record route rather
than repeated in a pack frame. The per-record encryption key is:

```text
recordKey = HKDF(
    roleKey,
    salt = recordSalt,
    info = canonicalBytes(
        "livesync/adaptive-journal/record/v1",
        recordKind,
        logicalKey
    )
)
```

`canonicalBytes` uses fixed-width numeric fields and explicit byte lengths, rather than ambiguous string
concatenation.

The existing `encryptBinary` helper cannot be reused unchanged because its HKDF `info` is empty and its AES-GCM call
does not accept additional authenticated data. The new format should reuse its reviewed PBKDF2, HKDF, IV, and AES-GCM
primitives behind a new domain-separated envelope API.

#### Chunk payload

`ChunkPayloadV1` contains the exact local Chunk ID, the Chunk-format version needed to validate it, and the canonical
Chunk bytes before transport compression. The receiver:

1. verifies the frame and payload digests and, in encrypted mode, AEAD;
2. decompresses according to the record codec;
3. recomputes the local Chunk ID from the bytes and declared Chunk-format version;
4. compares it with the payload ID;
5. derives the remote Chunk key again and compares it with the requested or indexed key; and
6. only then writes the Chunk through the maintained Chunk manager.

Compression is independent per record and may be `none` when compression does not reduce size. Old and new codec choices
can coexist because the codec is covered by record integrity protection and, in encrypted mode, AEAD.

#### Pack and index

`pack.bin` is a concatenation of complete `RecordFrameV1` values. It has no whole-pack compression or whole-pack
encryption. Its identifier is the base64url SHA-256 digest of its exact bytes, so an ordinary complete download verifies
the object before reading frames:

```text
packId = base64url(SHA-256(packBytes))
```

`indexes/<packId>.idx` is one index record, encrypted in encrypted mode and digest-protected plaintext in unencrypted
mode. Its payload contains entries sorted by the 32-byte binary remote Chunk key:

```text
PackIndexPayloadV1 :=
    entryCount:u32be
    entries[entryCount]

PackIndexEntryV1 :=
    remoteChunkKey[32]
    offset:u64be
    frameLength:u64be
    plaintextLength:u64be
    frameDigest[32]
```

The index envelope binds `repositoryId`, `packId`, its entry count, and its exact payload digest. A Range read verifies
`frameDigest` before the record's mode-specific integrity and AEAD checks; a whole-pack read verifies `packId` and then
the same per-record checks. The index is downloaded and cached as one small object. PostgREST stores the same
`RecordFrameV1` value directly in a Chunk row, so both physical strategies share framing and validation rather than only
TypeScript method names.

Keys are strictly increasing and unique. Every offset and length must identify one complete frame within the exact pack,
entries must not overlap, and the indexed frames must cover the pack without unindexed gaps. A decoder checks all
arithmetic for overflow before issuing a Range request or allocating a complete-pack buffer.

#### Recommended local pack cache

A complete-pack read stores the exact remote pack bytes under `(repositoryId, packId)` in a bounded, disposable LRU
cache. Normal incremental synchronisation materialises only the Chunks currently requested by `ChunkFetcher`; later
requests reuse the verified cached pack. Fast Setup may deliberately validate and materialise every record in the pack
to favour throughput.

A Range read may cache verified individual frames without pretending that a sparse file is a complete pack. Persistent
cache entries retain exact remote bytes, not separately decoded Chunk plaintext. In encrypted mode those bytes remain
encrypted. Cache loss or eviction affects performance only and never changes the receive frontier or authoritative
catalogue.

Pack targets must be expressed primarily in bytes. The initial experiment should compare small immutable Level 0
micro-packs with larger compacted Level 1 packs. A latency-sensitive synchronisation may publish a pack containing one
Chunk; it never rewrites an older pack merely to fill free space.

### Strategy comparison

| Property | Native batch CAS | Immutable pack CAS |
| --- | --- | --- |
| Logical identity | Opaque remote Chunk key | Opaque remote Chunk key |
| Ordinary write | Insert missing rows | Upload a new pack and index |
| Multi-key lookup | One bounded RPC | Local catalogue lookup |
| Multi-key read | One bounded or streamed RPC | Group by pack, then range or whole-pack reads |
| Physical duplicates | Preventable transactionally | Permitted temporarily |
| Ordinary shared mutation | Transactional derived index only | None |
| Compaction | Optional row maintenance | Repack live Chunks into a new generation |

## Pack lifecycle

A Chunk inside a pack is never changed. A file edit which replaces logical Chunk `B` with logical Chunk `D` produces a
new pack only for newly published content:

```text
Old Metadata: [A, B, C]
New Metadata: [A, D, C]

pack-001: [A, B, C]   unchanged
pack-002: [D]         new Level 0 pack
```

`B` may become unreachable, but `pack-001` remains available until a later protected compaction proves that it can be
retired. This trades temporary storage amplification for immutable, low-contention writes.

Small urgent writes may use either a one-batch micro-pack or a loose immutable object. Supporting both loose and packed
locations complicates the catalogue, so the first object-store experiment should use micro-packs consistently and add
loose objects only when measurements justify them.

## Versioned catalogue

### Authoritative state

The remote object-store catalogue is logically versioned but not rewritten in full for every ordinary write:

```text
catalogue/snapshots/<snapshot-id>.snapshot
writers/<writer-stream-id>.writer
catalogue/deltas/<writer-stream-id>/<sequence>.delta
metadata/<writer-stream-id>/<sequence>.batch
commits/<writer-stream-id>/<sequence>.commit
```

A delta can register a new pack:

```json
{
  "add": {
    "indexDigest": "<SHA-256 of exact stored index frame>",
    "indexKey": "indexes/pack-002.idx",
    "packBytes": 123456,
    "packId": "pack-002"
  },
  "formatVersion": 1,
  "repositoryId": "<repository ID>",
  "sequence": "00000000000000000001",
  "writerStreamId": "<opaque stream identifier>"
}
```

The index contains the Chunk-to-location entries, so a catalogue delta stays small. Concurrent writers publish
independent immutable deltas; their additions merge as a set and do not compete to replace one shared catalogue object.
The same logical Chunk may temporarily resolve to several valid packs.

A delta becomes authoritative only when a valid commit in the same writer sequence references its exact key and digest.
Listing a raw delta object is not evidence that its publication completed. A catalogue snapshot likewise records the
covered per-writer commit frontier and commit digests, rather than only the largest object name it observed.

These are logical keys. A WebDAV adapter may encode them as flat object names when the configured server cannot create
or list nested collections reliably.

The recommended WebDAV v1 mapping stays inside the one configured collection and uses only ASCII base64url identifiers,
20-digit sequences, and a reserved `a1~<kind>~...` prefix. For example:

```text
a1~manifest.json
a1~writer~<writer-stream-id>.writer
a1~pack~<pack-id>.bin
a1~index~<pack-id>.idx
a1~delta~<writer-stream-id>~<sequence>.delta
a1~metadata~<writer-stream-id>~<sequence>.batch
a1~commit~<writer-stream-id>~<sequence>.commit
a1~snapshot~<snapshot-id>.snapshot
a1~catalogue-latest.hint
```

Base64url fields have no padding and sequences have exactly 20 decimal digits. The mapping does not require nested
`MKCOL`. S3-compatible storage may retain hierarchical logical keys, while both mappings round-trip to the same
repository identifiers.

### Control record encoding and visibility

In encrypted mode, the recommended v1 privacy boundary leaves only the repository manifest, immutable object keys,
writer-stream routing, sequence numbers, object sizes, and access patterns visible. Pack indexes, catalogue deltas,
catalogue snapshots, Metadata batches, writer descriptors, and commit bodies use role-specific encrypted record
envelopes. Unencrypted mode uses the same envelopes with `cipherSuite: "none"` and makes those payloads visible.

After decryption, catalogue, writer-descriptor, and commit payloads use the same restricted canonical JSON subset as the
repository manifest. IDs and digests are base64url strings, counters and byte sizes are integers, and no field uses a
floating-point value. Metadata batches retain the maintained Journal document encoding instead. The canonical
representation is intended for deterministic hashing and fixtures; AEAD authenticates the exact stored bytes in
encrypted mode.

Every control payload repeats its repository ID and complete logical record identity. A decoder compares those fields
with the manifest, writer route, sequence, and frame kind before using the payload. This redundancy detects accidental
cross-key placement in unencrypted mode; it is not presented as authentication against a hostile remote.

An optional plaintext `catalogue/latest` hint may contain only a format version, snapshot object key, and ciphertext
digest. Encrypted mode authenticates the hint with a catalogue-hint key. It is never authoritative: a missing, stale, or
invalid hint causes snapshot and delta discovery from immutable keys.

### Local derived catalogue

A client loads the latest trusted snapshot it knows, follows each writer's later valid commits, applies their referenced
catalogue deltas, and builds a mutable local mapping:

```text
Remote Chunk key -> [pack ID, offset, length, generation]
```

This local catalogue is a cache. Corruption or loss causes reconstruction, not remote data loss.

An optional small `catalogue/latest` object may point to a recent snapshot. It is an optimisation hint rather than the
sole authority. S3-compatible storage can update it with an ETag precondition. A WebDAV implementation which cannot
rely on conditional updates can recover by listing valid snapshots and catalogue commits.

### Snapshotting

Catalogue deltas eventually make new-device initialisation expensive. A compactor periodically produces a complete
immutable snapshot:

```text
snapshot-100 + deltas 101..500 -> snapshot-500
```

The snapshot commit records its covered delta frontier, integrity hash, format version, and predecessor information.
Readers apply deltas outside that frontier. Old snapshots and covered deltas remain available for a grace period before
protected deletion.

### Writer discovery and frontiers

A writer stream is keyed by `(hostId, writerEpoch)`. `hostId` is the stable device identity. `writerEpoch` is generated
randomly and persisted with that remote repository binding. It changes when a cloned host or a host which has lost its
send sequence begins writing, preventing two processes with stale local state from sharing one sequence.

The tuple is the logical identity. Encrypted mode may encode the physical `writerStreamId` as an HMAC under a
domain-separated writer-name key so that the remote does not receive the raw stable host ID. Unencrypted mode may use a
repository-scoped digest. Readers use the immutable writer descriptor, encrypted in encrypted mode, to recover the
logical fields.

```text
writerStreamId = HMAC-SHA-256(
    roleKey("writer-name"),
    canonical(hostId, writerEpoch)
)
```

Each stream uses a positive 63-bit sequence in the range `1..9223372036854775807`. This fits PostgreSQL `bigint`,
uses `u64be` with the high bit clear in canonical binary records, and uses zero-padded 20-digit decimal in object names.
Sequence assignment is dense:

```text
commits/host-a/epoch-x/00000000000000000001.commit
commits/host-a/epoch-x/00000000000000000002.commit
commits/host-b/epoch-y/00000000000000000001.commit
```

A writer which could exhaust the range creates a new writer epoch before assigning another sequence; wrapping to zero
or a negative database value is invalid.

A reader discovers immutable writer descriptors, then lists each writer stream after its own stored sequence. The
receive checkpoint is a map from writer stream ID to the highest contiguous, fully applied sequence. A reader does not
advance past a missing sequence, and it continues processing independent streams while one stream is incomplete.

Writer discovery itself must not use one global `StartAfter` maximum, because a newly registered writer may sort before
that maximum. The descriptor set is expected to remain small enough for complete listing initially. A reconstructible
writer snapshot may optimise discovery later.

There is no cross-writer timestamp order. PouchDB revision ancestry and conflict branches carry the causal information
needed for convergence. Adaptive Journal Sync preserves those exact revision histories; the repository only guarantees
publication order within one writer stream.

### Writer state and crash recovery

The device-local repository binding persists:

```ts
type AdaptiveWriterState = {
    repositoryId: string;
    writerEpoch: string;
    pendingWriterDescriptor?: {
        key: string;
        exactBytes: Uint8Array;
        digest: string;
    };
    lastCommittedSequence: string;
    lastCommitDigest: string | null;
    pendingCommit?: {
        sequence: string;
        key: string;
        exactBytes: Uint8Array;
        digest: string;
    };
};
```

The epoch is generated locally, saved before publication, and registered through an immutable conditional writer
descriptor. The exact descriptor frame is persisted with `pendingWriterDescriptor` before that create. Success or an
unknown response is resolved by reading the descriptor key and comparing its exact digest; no commit is attempted until
registration has been confirmed and the pending value cleared atomically. A different digest at the same writer stream
ID is a collision.

The writer does not reconstruct and continue an old epoch after losing this local state; it creates a new epoch and
leaves the old stream readable.

Publication uses the following crash boundary:

1. Allocate `lastCommittedSequence + 1` without publishing a later sequence.
2. Upload and verify any Chunk frames, pack, index, catalogue delta, and Metadata batch. A crash here may leave harmless
   unreachable objects.
3. Build the final commit record, then durably store its exact key, bytes, and digest as `pendingCommit`.
4. Create the commit conditionally.
5. On success or an unknown response, read the commit key and require an exact digest match.
6. Atomically advance `lastCommittedSequence` and `lastCommitDigest`, then clear `pendingCommit`.
7. After restart, resolve `pendingCommit` before creating any new publication.

Only the small final commit must be retained byte-for-byte across the uncertain mutation. Earlier immutable objects can
be verified and reused. Before rebuilding an object with a fixed logical key, such as a Metadata batch, catalogue delta,
or pack index, a restarted writer reads that key first. A valid existing record is adopted, a missing record may be
rebuilt, and a different logical value is a collision rather than permission to overwrite. A not-yet-referenced pack
candidate may instead be abandoned and replaced under a new content-derived pack ID.

PostgREST uses the same idempotency key, sequence, and previous digest even when one transaction performs the final
server-side verification and commit.

## Publication protocol

### Recommended Metadata and commit records

`MetadataBatchV1` reuses the maintained Journal document encoding after excluding Chunk documents. It preserves each
PouchDB document ID, exact revision, revision ancestry, deletion marker, conflict branch, Metadata fields, and logical
Chunk references. The batch also records the sorted set of required remote Chunk keys. It is compressed as one bounded
batch, then placed in a metadata-record envelope. Encrypted mode encrypts it with AAD binding the repository ID, writer
stream, and sequence; unencrypted mode stores the same bounded payload without encryption.

The final `CommitV1` control payload, encrypted in encrypted mode, contains:

```json
{
  "catalogueDeltas": [
    {
      "digest": "<SHA-256 of exact stored bytes>",
      "key": "<immutable delta key>"
    }
  ],
  "formatVersion": 1,
  "metadata": {
    "bytes": 1234,
    "digest": "<SHA-256 of exact stored bytes>",
    "key": "<immutable Metadata batch key>"
  },
  "previousCommitDigest": "<digest or null>",
  "repositoryId": "<repository ID>",
  "requiredChunkKeysDigest": "<digest of the sorted required-key set>",
  "sequence": "00000000000000000001",
  "writerStreamId": "<opaque stream identifier>"
}
```

The commit's own digest is SHA-256 over its exact stored bytes. `previousCommitDigest` forms a per-writer hash chain in
addition to the dense sequence, detecting an unexpected predecessor or a listing gap. An optional creation time may
exist inside the payload for diagnostics, but it has no ordering semantics.

For PostgREST, the transaction receives the same sorted required-key set and verifies its digest before checking Chunk
and Metadata row existence and inserting the commit. For object stores, the client verifies the referenced pack, index,
catalogue, and Metadata objects before creating the commit. Readers ignore all uncommitted data objects.

### Common publication state machine

The final commit, rather than successful upload of any preceding object, changes reader-visible state:

| Observed state | Reader and writer interpretation |
| --- | --- |
| Data objects exist, commit is missing | Incomplete or abandoned publication; readers ignore it |
| Commit exists and every referenced digest and dependency validates | Publication is eligible for receive |
| Commit is missing after an unknown create result | Writer retries the read; it does not allocate the next sequence |
| Commit key exists with the intended exact digest | Idempotent success |
| Commit key exists with a different digest | Writer-state collision or repository corruption; stop the stream |
| Commit is valid but a dependency is temporarily unavailable | Do not advance this stream; other writer streams may continue |
| Sequence `N + 1` is visible while `N` is missing | Do not skip the gap or infer deletion from listing order |

An adapter may combine physical steps in one database transaction, but it must expose these same outcomes. In
particular, an HTTP success for a data upload is not a commit, and an HTTP timeout is not evidence that a commit failed.

### Object-store publication

1. Build and validate a Chunk micro-pack locally.
2. Upload the immutable pack under a unique ID.
3. Upload its immutable index.
4. Publish an immutable catalogue delta which registers the pack.
5. Upload the Metadata batch record.
6. Publish the batch commit manifest at the next sequence in this writer stream.
7. Advance the local send checkpoint only after the commit manifest succeeds.

A failure before step 6 may leave unreachable objects, but it does not publish Metadata with unavailable Chunk
references. A retry can reuse verified immutable objects or publish replacements under new IDs. Later maintenance can
remove unreachable incomplete publications.

The writer does not begin sequence `N + 1` while the result of sequence `N` is unknown. After a transport timeout, it
reads and verifies the intended immutable commit or retries the same key and bytes. A conditional conflict is acceptable
only when the existing object has the same authenticated identity. Otherwise the writer stops and reports repository
corruption or writer-state collision.

### Native CAS publication

The recommended PostgreSQL path keeps potentially large Chunk insertion outside the small final publication
transaction:

1. Use bounded `has_chunks` and `put_chunks` RPCs to insert missing immutable Chunk rows.
2. Resolve every different-frame conflict by fetching and validating the existing logical Chunk.
3. Build and conditionally insert the immutable Metadata frame. On conflict or an unknown response, read it and validate
   its logical identity and content before reuse.
4. Build the exact commit frame, then persist it as the local `pendingCommit`.
5. Call `commit_metadata_batch` with the sorted, unique required-key set, Metadata digest, and commit frame.
6. In one transaction, derive `vault_id` from the signed claim, verify the repository and writer stream, recompute the
   required-key-set digest, require every Chunk and Metadata row, enforce the dense sequence and previous commit digest,
   and insert the commit row.
7. On success or an unknown response, read the commit by `(repositoryId, writerStreamId, sequence)` and compare its exact
   digest before advancing local state.

The final transaction does not resend Chunk or Metadata bodies and does not need a native Chunk catalogue; its
`catalogueDeltas` list is empty. Bounded pre-publication transactions may leave harmless unreferenced rows after a
crash, just as object storage may leave unreferenced packs. This separation limits transaction memory and lock duration
while retaining atomic Metadata visibility.

### Receive

1. Discover writer streams and list commit records after each per-writer frontier.
2. Require the next dense sequence, validate the writer descriptor, commit frame, previous digest, and every referenced
   exact-byte digest.
3. Load, decrypt when applicable, and validate the Metadata batch.
4. Derive the sorted required remote Chunk keys from its logical Chunk references and compare their digest with the
   commit.
5. Collect the referenced Chunks missing from the local database.
6. Call `getMany` once per bounded byte and count window.
7. Let the Chunk Store group object-store requests by pack or issue a native batch RPC.
8. Validate and persist Chunks.
9. Apply Metadata revisions through the maintained PouchDB revision contract.
10. Advance the receive checkpoint only after the batch reaches its terminal state.

A commit manifest may include non-authoritative location hints for newly published Chunks. Metadata continues to refer
only to logical Chunk IDs so that repacking never changes file revisions.

## Concurrency and failure model

Ordinary publication is multi-writer and append-only:

- pack IDs, delta IDs, and batch IDs must be globally collision-resistant;
- one writer stream has exactly one publisher and one dense sequence;
- concurrent publication of the same logical Chunk may create physical duplicates;
- catalogue additions merge without a last-write-wins replacement;
- failed uploads remain unreachable until maintenance removes them; and
- retries are idempotent at the logical Chunk and Metadata revision boundaries.

The current opaque Journal filename cursor takes one global maximum after sorting timestamp-shaped keys. Adaptive
Journal Sync must not reuse that rule. A late writer, reset clock, or delayed upload can sort before the recorded
maximum. Per-writer frontiers make `StartAfter` safe only inside an already discovered stream.

Physical retirement and deletion require stronger coordination than addition. A compactor must use a bounded lease or
fencing token appropriate to the remote. A stale compactor may upload a redundant replacement pack, but it must not
publish a retirement or delete an object after losing its authority.

The protocol must test each failure boundary independently: pack upload, index upload, catalogue delta publication,
Metadata upload, commit publication, checkpoint persistence, snapshot publication, retirement, and deletion.

## WebDAV server safety checker

WebDAV implementations, gateways, and authentication layers vary even when they expose the same methods. Server
implementations should strive to preserve the required semantics, but configuration must rely on a non-destructive
empirical checker rather than a product-name allowlist or a standards-compliance assumption.

The checker creates random probe keys in a reserved temporary namespace inside the configured collection. It touches no
existing Journal key, attempts to remove every probe in a `finally` path, and reports any residual key when cleanup
cannot be confirmed. It does not log credentials, custom headers, response bodies, or secret-bearing URLs.

Each check reports `passed`, `failed`, or `inconclusive`, together with a bounded, sanitised reason:

| Profile | Capability | Probe |
| --- | --- | --- |
| Opaque Journal safety | Collection access | Create or access the configured collection |
| Opaque Journal safety | Binary fidelity | `PUT` non-text bytes, then `GET` and compare exactly |
| Opaque Journal safety | Read-after-write | Observe the newly written bytes without stale-cache substitution |
| Opaque Journal safety | Complete depth-one listing | Confirm that `PROPFIND` includes the owned probe key |
| Opaque Journal safety | Delete visibility | Delete the probe, then confirm that its `GET` is explicitly missing |
| Adaptive Journal safety | Conditional create | Create with `If-None-Match: *`, reject a second different body, and retain the first body |
| Optional optimisation | Byte-range read | Request a non-trivial byte interval and require an exact `206` response |

An HTTP `200` whole body in response to the Range probe means that byte-range optimisation is unsupported; it does not
make the server unsafe. A `206` response must contain the requested bytes and a consistent `Content-Range`. Timeout or
transport ambiguity is `inconclusive`, not evidence that an object is missing.

The report answers only whether the endpoint exhibits each capability. It does not benchmark the endpoint, predict
which retrieval policy is faster, or recommend a user preference. Existing opaque Journal mode requires the opaque
safety profile. Adaptive mode additionally requires confirmed conditional create. A user may choose `whole-pack`
regardless of Range support, or choose `range` after the optional probe passes.

The recommended schedule runs the checker during an explicit connection test and before the first Adaptive write in a
new repository-client session. A session may reuse the report until endpoint, collection, credentials, or custom headers
change. A semantic failure of a previously passed operation invalidates the cached report. It need not create probe
objects for every ordinary synchronisation.

## Encryption and privacy

The current whole-pack encryption can hide document IDs, Chunk IDs, and pack contents from the storage service. Native
CAS and searchable pack indexes introduce different leakage, so they require an explicit threat-model review.

### Recommended key lifecycle

The per-Chunk `remoteChunkKey` is never randomly generated. It is deterministically derived locally on demand after the
immutable manifest has established the repository key schedule, and it is not stored as a secret mapping.

The recommended derivation and creation boundary is:

| Value | Creation or derivation time | Persistence |
| --- | --- | --- |
| `repositoryId`, Security Seed | Generated with a secure local random source only when a manifest read returns explicit `missing`; the winning conditional create selects the repository values | Immutable remote manifest and local repository binding |
| Master key and role keys | Derived locally in encrypted mode after every repository-client open and successful manifest authentication | Memory only |
| Writer epoch | Generated locally after manifest acceptance and before the first publication by that device binding | Device-local writer state and immutable remote writer descriptor |
| `remoteChunkKey` | Derived on demand when a referenced Chunk is checked, stored, or fetched | Normally not persisted; a disposable local cache is permitted |
| Record salt and IV | Generated locally each time a secure record frame is first encoded | Inside that immutable frame |
| Pack ID and frame digest | Derived after the exact immutable bytes have been finalised | Immutable object key, index, row, or commit reference |

The order matters: an explicit remote failure never triggers local candidate generation, and no writer or Chunk
identity is committed before the manifest has been read back and accepted. A candidate generated by a losing
initialiser is discarded as one unit.

For an encrypted repository:

```text
masterKey = PBKDF2-HMAC-SHA-256(
    passphrase,
    manifest.securitySeed,
    iterations = 310000,
    outputBytes = 32
)

roleKey(role) = HKDF-SHA-256(
    masterKey,
    salt = decodeBase64url(manifest.repositoryId),
    info = UTF8("livesync/adaptive-journal/v1/" || role),
    outputBytes = 32
)

remoteChunkKey = HMAC-SHA-256(
    roleKey("chunk-identity"),
    canonicalUTF8(localChunkID)
)
```

`canonicalUTF8` includes a format-domain prefix and an explicit byte length before the exact local Chunk ID, avoiding
string-concatenation ambiguity. Binary remote Chunk keys remain 32 bytes internally and use base64url only in an object
key or JSON field.

Record salt, IV, compression choice, and pack location are not inputs to this derivation. Two clients therefore derive
the same `remoteChunkKey` for the same local Chunk ID even when they independently produce different encrypted
`RecordFrameV1` bytes. The derived key changes only when the local Chunk ID or repository key namespace changes; the
latter is an explicit full migration.

Recommended role labels are:

- `manifest-auth`;
- `chunk-identity`;
- `chunk-record`;
- `pack-index`;
- `metadata-record`;
- `catalogue-record`;
- `commit-record`;
- `writer-record`;
- `catalogue-hint`; and
- `writer-name`.

The first client creates the manifest's random `repositoryId` and Security Seed locally, but no random
`vaultChunkIdentityKey` is persisted or uploaded. Every device derives the same role keys after reading and
authenticating the winning manifest. Derived keys are cached in memory and discarded with the repository client.

Generating a separate random identity secret only in local settings is not recommended for v1. It would need a new
secure multi-device transfer, backup, rotation, and loss-recovery contract even when the repository content is not
encrypted. Domain-separated derivation from the existing shared passphrase avoids that second secret lifecycle.

### Unencrypted repositories

The current opaque Journal code also skips encryption when its passphrase is empty. Adaptive v1 must not treat an empty
passphrase as protocol negotiation: `encrypt: false` explicitly selects unencrypted mode, while `encrypt: true` requires
a non-empty passphrase and fails configuration before reading or creating an encrypted manifest. In unencrypted mode,
the implementation must not describe a derived key as secret. The recommended functional mode is:

```text
remoteChunkKey = SHA-256(
    "livesync/adaptive-journal/v1/public-chunk-identity" ||
    repositoryId ||
    canonicalUTF8(localChunkID)
)
```

The manifest records `chunkKeyMode: "repository-scoped-sha256"` and `cipherSuite: "none"`.
`manifestAuth` is then a public SHA-256 integrity digest rather than authentication against a hostile remote. This
prevents accidental cross-repository equality but does not prevent content guessing or deliberate correlation. That
weaker property is consistent with storing the corresponding Journal records without E2EE and must be presented
explicitly.

Public-mode frame, pack, index, and commit digests detect accidental corruption and bind references by exact bytes.
They do not prevent a remote administrator from rewriting a public repository. Logical Chunk-ID recomputation and
remote-key derivation still prevent an unrelated payload from being accepted accidentally under a requested Chunk key.

### Verification and rotation

In encrypted mode, `manifestAuth` is HMAC-SHA-256 under `roleKey("manifest-auth")`. A wrong passphrase, changed Security
Seed, substituted repository ID, or modified format field fails before any repository write. As with any
password-verification value, it permits offline guesses against a captured manifest; the existing encrypted Journal
already exposes an equivalent password-verification opportunity through authenticated ciphertext.

For byte-range pack reads, each Chunk record is encrypted and authenticated independently as defined above. Physical
pack location is deliberately absent from the logical Chunk AAD, allowing a validated frame to be copied during
repacking without changing Metadata or remote Chunk identity.

PostgREST needs server-visible remote Chunk keys to execute a multi-key query. It does not need plaintext file paths,
local Chunk IDs, or decrypted content. Object-store catalogue and index bodies remain encrypted; the remote still sees
object names, sizes, equality within one repository, and access patterns.

Bearer-token, WebDAV password, custom-header, and server-credential rotation do not change repository keys. Changing
the E2EE passphrase, Security Seed, repository ID, chunk-key mode, or role-label version creates a new repository
namespace and requires an explicit full migration. A remote reset creates a new repository ID and Security Seed.

## Garbage Collection and repacking

Garbage Collection is a reachability operation, not an age-only deletion policy.

At minimum, the reachability set must protect the current Metadata winner and every live conflict branch. The treatment
of non-live retained revision history must be an explicit shared decision with the maintained Garbage Collection
specification. A design which silently makes retained history unreadable is not acceptable.

Object-store compaction follows a generational copy-and-publish process:

1. Freeze a reachability and catalogue frontier under a valid fencing token.
2. Read live Chunks from selected Level 0 and Level 1 packs.
3. Write new immutable Level 1 packs and indexes.
4. Publish catalogue additions for the new packs.
5. Publish a new snapshot or retirement delta which prefers the new generation.
6. Retain old packs for the defined device-progress and time-based grace conditions.
7. Delete retired packs only after the protection conditions remain satisfied.

Metadata does not change during repacking because the catalogue provides indirection from logical Chunk IDs to physical
locations.

Native row CAS can delete unreachable rows without repacking, but it must use the same reachability and retention
policy. PostgreSQL transactionality simplifies mutation; it does not prove that a Chunk is safe to delete.

## Compatibility and migration

Adaptive Journal Sync requires an explicit protocol and capability version recorded in the remote milestone or its
successor. A device which understands only opaque Journal packs must not partially consume Metadata-only batches.

Journal connection settings should separate three independent choices internally:

```ts
type JournalConnectionProfile = {
    replicator: "journal";
    provider: "s3" | "webdav" | "postgrest";
    protocol: "opaque-v1" | "adaptive-v1";
    expectedEncryption: "encrypted" | "unencrypted";
    expectedRepositoryId?: string;
    packReadPolicy?: "whole-pack" | "range";
};
```

This does not require one `adaptive` boolean for every provider. Existing provider-specific URI schemes may remain
serialisation formats and carry one shared `journalFormat=adaptive-v1` value. Its absence means `opaque-v1`. The remote
repository manifest is the authority for the actual format, while the connection profile records the expected format.
The expected encryption mode and, after the first accepted binding, repository ID are pinned locally as well. They must
match before any write.

The existing remote layout and the adaptive layout should use disjoint prefixes or schemas during experimentation. An
opt-in test Vault may rebuild into the adaptive representation, but an ordinary upgrade must not migrate or delete an
existing remote implicitly.

Protocol mismatch is a repository-safety failure, not an ordinary tweak mismatch. A setting which relaxes tweak-value
checks must not bypass it. Provider credentials may rotate without changing the format, repository identity, or
checkpoint; changing provider, storage location, repository ID, or protocol creates a distinct binding.

The compatibility plan must define:

- negotiation between old and adaptive clients;
- rollback before and after the first adaptive commit;
- coexistence or exclusion rules for mixed client versions;
- checkpoint identity and epoch changes;
- remote reset behaviour;
- encryption-key and Chunk-identity-key migration; and
- exact conditions which require Fetch, Rebuild, or a new remote profile.

### Initial provider capability matrix

| Capability | PostgREST | S3-compatible storage | WebDAV |
| --- | --- | --- | --- |
| Typed explicit missing | RPC/HTTP status mapping | SDK/HTTP status mapping | HTTP status mapping |
| Immutable conditional create | Unique insert-only RPC | `If-None-Match` | Probe `If-None-Match: *` |
| Native multi-key Chunk lookup | Yes, bounded RPC | No | No |
| Atomic Chunk verification and Metadata commit | Yes, transaction | No, commit manifest | No, commit manifest |
| Complete object listing | Indexed keyset query | Prefix listing | Depth-one `PROPFIND` |
| Whole-pack read | Available | Available | Required |
| Byte-range optimisation | Not needed for row CAS | Usually available, verify | Optional, probe |

This matrix chooses a likely implementation strategy but does not replace endpoint checks. The common adaptive
repository is defined by the semantic rows, not by identical adapter methods or identical physical layouts.

## Performance model

Adaptive selection must optimise total work rather than request count alone. Measurements need to include:

- number of network requests;
- transferred and over-fetched bytes;
- first-Metadata and first-complete-file latency;
- CPU, memory, compression, and encryption cost;
- remote storage amplification;
- catalogue initialisation and update cost;
- PostgREST query, transaction, and response framing cost;
- S3-compatible request charging and range behaviour; and
- WebDAV listing, range support, and whole-pack fallback.

The benchmark matrix should vary Vault size, retained history, Chunk-size distribution, editing pattern, network
round-trip time, proxy path, concurrent writers, and new-device versus incremental synchronisation.

The first implementation does not calculate a recommendation from these measurements. A user selects whole-pack or
Range retrieval according to the endpoint capability report and their own deployment knowledge. Measurements may later
justify an optional automatic policy, but provider names alone must not become performance policy.

## Planned implementation stages

### Stage 0: Executable model

- Define typed remote outcomes and the repository, Chunk Store, per-writer stream, catalogue, and commit state machines
  independently of a transport.
- Add property and fault-injection tests for publication ordering, retry, duplicate physical locations, and recovery.
- Freeze canonical manifest, key-schedule, frame, control-record, and digest fixtures across supported runtimes.
- Record the threat model and remote-visible metadata for encrypted and unencrypted modes.

### Stage 1: Manifest and endpoint safety

- Add the single immutable repository manifest, Security Seed, role-key derivation, and read-back authentication.
- Implement conditional-create semantics in each adaptive adapter.
- Add the non-destructive WebDAV capability checker, with Range reported as optional.
- Fail closed on ambiguous initialisation and repository-format mismatch.

### Stage 2: Native batch CAS experiment

- Add disposable PostgreSQL/PostgREST bounded binary RPCs for batched Chunk availability, insertion, retrieval, and
  Metadata commit.
- Measure RPC framing, transaction size, memory, and proxy limits.
- Verify Vault isolation and failure rollback through real service integration tests.

### Stage 3: Chunk retrieval integration

- Connect the adaptive repository to the existing Journal `fetchRemoteChunks` producer.
- Reuse `ChunkFetcher` batching, validation, persistence, waiting, and terminal-condition behaviour.
- Keep received PouchDB revision histories on the maintained Journal application path.

### Stage 4: Immutable object-pack experiment

- Implement the reviewed `RecordFrameV1`, content-digest pack ID, and mode-appropriate index format.
- Implement catalogue deltas and a local derived catalogue.
- Implement the whole-pack canonical path for S3-compatible storage and WebDAV.
- Add manually selected Range retrieval where the endpoint probe confirms support.
- Validate bounded request behaviour without per-Chunk `HEAD` or `GET` loops.

### Stage 5: Snapshot and compaction

- Add catalogue snapshots, retirement records, fencing, grace conditions, and recovery.
- Implement conservative repacking without Metadata rewrites.
- Exercise concurrent writers and interrupted compactors.

### Stage 6: Consumer integration

- Add multi-device Commonlib integration, CLI consumption, and focused real-Obsidian tests.
- Define opt-in migration, rollback, diagnostics, and maintenance controls.

### Stage 7: Release decision

- Compare the adaptive paths with the current opaque Journal baseline.
- Review privacy, corruption recovery, storage amplification, and operational complexity.
- Select supported strategies and thresholds only after the evidence is available.

## Test obligations

Stage 0 must commit language-neutral fixture inputs and exact expected bytes:

| Fixture group | Contract frozen by the fixture |
| --- | --- |
| Encrypted and unencrypted manifests | Canonical JSON, manifest check, fixed parameter tuple, and repository-ID pinning |
| Key schedule | Master and role keys, encrypted and unencrypted `remoteChunkKey`, and writer stream ID |
| Record frames | Every v1 record kind, both encryption modes, both codecs, header lengths, AAD, digest, and rejection cases |
| Native batch envelopes | HAS, GET, and PUT ordering, every per-entry status, length fields, and byte ceilings |
| Commit envelope | Required-key sorting and digest, previous-commit link, Metadata digest, and exact idempotency digest |
| Pack and index | Pack digest, sorted index bytes, offsets, complete reads, and Range reads |
| Writer recovery | Pending initialisation, descriptor registration, uncertain commit, sequence gap, and new-epoch recovery |

Fixtures use fixed passphrases, seeds, IDs, salts, IVs, payloads, and expected failure categories. Randomised production
paths inject those values at the cryptographic boundary so the same encoder and decoder can be tested without weakening
runtime randomness. DEFLATE fixtures freeze accepted stored streams and expected plaintext, not one mandatory compressor
output; independently valid compressed frames may differ while deriving the same Remote Chunk key.

- Metadata is never committed before all newly required Chunks have a durable source.
- One logical Chunk ID never resolves to different accepted plaintext bytes.
- Batch retry, duplicate physical storage, and concurrent publication are idempotent.
- Missing, conflict, authentication failure, permission denial, timeout, and server failure remain distinguishable at
  the adaptive repository boundary.
- Concurrent repository initialisation selects one immutable manifest without last-write-wins replacement.
- `attach-existing` never initialises a missing remote, and an exported expected repository ID must match.
- Restart resolves `pendingInitialisation` and `pendingWriterDescriptor` before creating another identity or commit.
- Manifest fixtures derive identical role keys across supported runtimes, and a wrong passphrase fails before writes.
- A previously pinned repository ID rejects a substituted manifest, including one authenticated by a reused passphrase.
- An encrypted local profile rejects an unencrypted or weakened manifest before writes, and encrypted and unencrypted
  modes expose exactly their documented identity and privacy properties.
- Every binary frame rejects unsupported versions, excessive lengths, truncated fields, invalid AEAD, wrong logical
  keys, invalid unencrypted payload digests, and mismatched local Chunk IDs before persistence.
- Writer streams recover an uncertain commit before publishing the next sequence.
- Restart resolves an exact persisted pending commit before assigning a later writer sequence.
- A delayed or newly discovered writer cannot be hidden by another writer's frontier.
- Receivers stop at a per-stream sequence gap without blocking complete independent streams.
- Native CAS batch limits are enforced by count and bytes.
- PostgREST binary RPCs preserve input order, distinguish missing rows, force read-validation of a differently framed
  existing Chunk, reject a different logical value, and roll back an incomplete transactional Metadata commit.
- Two independently encrypted frames for one logical Chunk derive the same remote Chunk key, and the losing insert
  validates and accepts the winning plaintext.
- Object-pack retrieval groups requests by pack and avoids per-Chunk network loops.
- Range and whole-pack retrieval produce identical validated Chunk results.
- Complete-pack digest, index digest, frame digest, and record AEAD failures are independently detected.
- The WebDAV checker touches only its random probe keys, reports conditional-create and Range capabilities separately,
  and reports incomplete cleanup.
- Catalogue reconstruction from snapshots and deltas is deterministic.
- A stale snapshot hint cannot hide later valid deltas.
- Interrupted snapshotting, repacking, retirement, and deletion preserve readable data.
- Every protected Metadata winner and live conflict branch remains reconstructible.
- Direct Chunk delivery integrates with the maintained waiting and finite-activity boundaries.
- Vault-scoped access and opaque remote Chunk identity prevent cross-Vault retrieval.
- Mixed protocol versions fail closed before publishing incompatible Metadata.

## Recommended v1 decisions

The Planning baseline uses these choices unless implementation evidence requires a deliberate revision:

- one conditionally created Adaptive manifest owns both repository identity and the Security Seed;
- encrypted repositories derive every role key locally from the existing shared passphrase, while unencrypted
  repositories use an explicitly weaker repository-scoped digest rather than a new hidden local secret;
- in encrypted mode, remotely visible routing is limited to the repository manifest, immutable object names, writer
  streams, sequences, sizes, and access patterns, while indexes, catalogue records, Metadata, and commits are encrypted;
- independently verifiable binary Chunk frames are shared by PostgREST rows and immutable object packs, with AEAD in
  encrypted mode;
- pack IDs, index entries, commit links, and pending writer state use exact-byte digests;
- PostgREST v1 uses bounded binary `bytea` RPC envelopes rather than JSON-encoded Chunk bodies;
- a lost local writer state starts a new writer epoch rather than guessing how to continue the old stream; and
- Range is a manual performance preference with a safe whole-pack fallback.

The following remain deferred design work and do not block the first read/write experiment:

- whether a small urgent publication may use a loose immutable Chunk object instead of a micro-pack;
- which lease or fencing mechanisms protect maintenance across S3-compatible storage, WebDAV, and PostgREST;
- what reachability and retention policy protects non-live revision history;
- when PostgreSQL `bytea` remains operationally appropriate and when a deployment should use an external object store;
  and
- which measurements would justify adding an optional automatic pack-read policy.

No implementation stage should silently revise the reviewed choices through incidental adapter behaviour.
