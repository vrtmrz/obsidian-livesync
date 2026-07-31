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

- a batch-capable database such as PostgreSQL exposed through PostgREST could store one encrypted Chunk per immutable
  row and answer multi-key requests through one RPC; and
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

### Native CAS

A remote representation in which one logical Chunk maps to one insert-only value addressable by an opaque Chunk key.
PostgreSQL is the initial candidate because it can answer `hasMany`, `getMany`, and `putMany` through bounded batch RPCs.

### Chunk pack

An immutable physical object containing one or more independently verifiable encrypted Chunk records. A pack is a
request-amortisation and compaction unit, not the logical identity of its Chunks.

### Catalogue

The reconstructible mapping from opaque remote Chunk keys to one or more physical pack locations. Its authoritative
object-storage representation consists of immutable snapshots and append-only deltas. A local in-memory or persistent
catalogue may be mutable because it is derived state.

### Metadata batch

An immutable group of Metadata revision events. It refers to logical Chunk IDs and contains no raw Chunk content.

### Commit manifest

The final publication record for a Metadata batch. A reader ignores an incomplete batch until its commit manifest is
visible and valid.

## Required invariants

1. Metadata contains Chunk references, never raw file content.
2. A logical Chunk ID identifies immutable bytes.
3. A committed Metadata reference is not published before at least one valid remote source for that Chunk is durable.
4. Ordinary writers create immutable records. They do not edit an existing pack, catalogue snapshot, or catalogue
   delta.
5. A retry may create a duplicate physical Chunk or pack, but it must not create two logical meanings for one Chunk ID.
6. A receiver validates identity and authenticated encryption before accepting a Chunk.
7. A derived catalogue, cache, or PostgreSQL materialised index can be discarded and reconstructed.
8. Repacking does not require Metadata revision changes because Metadata refers to logical Chunk IDs rather than pack
   locations.
9. Remote reset, protocol migration, compaction, retirement, and deletion remain explicit protected operations.
10. The protocol must define a bounded completion or failure condition for each requested Chunk batch.

## Proposed repository boundary

`IJournalStorage` remains useful as the current opaque-object transport. Adaptive Journal Sync would introduce a
higher-level repository composition:

```ts
interface JournalEventStore {
    appendMetadataBatch(batch: EncryptedMetadataBatch): Promise<BatchCommit>;
    listMetadataBatches(after: BatchCursor, limit: number): Promise<EncryptedMetadataBatch[]>;
}

interface ChunkStore {
    capabilities(): ChunkStoreCapabilities;
    hasMany(ids: readonly RemoteChunkKey[]): Promise<ChunkAvailability>;
    putMany(chunks: readonly EncryptedChunk[]): Promise<ChunkPublication>;
    getMany(ids: readonly RemoteChunkKey[]): Promise<ChunkResult>;
}

interface AdaptiveJournalRepository {
    events: JournalEventStore;
    chunks: ChunkStore;
}
```

The interface is batched even when the physical remote lacks a native batch operation. The implementation owns request
planning and must not make the caller loop over one network request per Chunk.

Capability selection should describe semantics rather than provider names. Candidate capabilities include:

- bounded native multi-key lookup;
- bounded native multi-value read and write;
- atomic batch publication;
- conditional object writes;
- byte-range reads;
- inexpensive ordered listing; and
- server-side immutable CAS insertion.

The first implementation can use a fixed strategy per adapter. Dynamic thresholds may be added only after measurements
show that they improve the same contract.

## Physical strategies

### Native batch CAS

PostgREST can expose a Vault-scoped, row-level-security-protected Chunk table:

```sql
create table chunks (
    vault_id text not null,
    chunk_key text collate "C" not null,
    encrypted_body bytea not null,
    size_bytes bigint not null,
    created_at timestamptz not null,
    primary key (vault_id, chunk_key)
);
```

The public API would use bounded RPCs rather than one ordinary REST request per row:

- `has_chunks(keys[])` returns a compact availability result;
- `get_chunks(keys[])` returns a framed or streamed binary batch;
- `put_chunks(keys[], bodies[])` inserts missing immutable rows and verifies existing identities; and
- `commit_metadata_batch(...)` publishes the Metadata batch only after its required Chunks are present.

The exact request limits must be byte-based as well as count-based. A request containing hundreds of small Chunks and a
request containing hundreds of large Chunks do not have equivalent memory or proxy cost.

PostgreSQL may maintain mutable derived indexes transactionally. The Chunk rows themselves remain immutable CAS values,
and any separately maintained operational index must be rebuildable from authoritative rows and batch commits.

### Immutable pack CAS

S3-compatible Object Storage and WebDAV do not normally provide multi-key value retrieval. Storing one remote object per
Chunk would turn a missing set of 1,000 Chunks into as many as 1,000 existence requests and 1,000 value requests.
Parallel HTTP requests reduce elapsed time but do not remove request cost, connection pressure, or service charging.

The pack strategy groups newly published Chunks into immutable objects:

```text
packs/<pack-id>.bin
indexes/<pack-id>.idx
catalogue/deltas/<delta-id>
```

The pack index maps each opaque remote Chunk key to its ciphertext offset, ciphertext length, and integrity information.
S3-compatible storage can use byte-range reads when the pack format encrypts and authenticates records independently.
WebDAV can fetch the complete pack when reliable range reads are unavailable. Both paths expose the same batched
`getMany` result.

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
catalogue/snapshots/<generation>
catalogue/deltas/<writer-id>/<delta-id>
catalogue/commits/<commit-id>
```

A delta can register a new pack:

```json
{
  "add": {
    "packId": "pack-002",
    "index": "indexes/pack-002.idx"
  }
}
```

The index contains the Chunk-to-location entries, so a catalogue delta stays small. Concurrent writers publish
independent immutable deltas; their additions merge as a set and do not compete to replace one shared catalogue object.
The same logical Chunk may temporarily resolve to several valid packs.

### Local derived catalogue

A client loads the latest trusted snapshot it knows, applies later deltas, and builds a mutable local mapping:

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

## Publication protocol

### Object-store publication

1. Build and validate a Chunk micro-pack locally.
2. Upload the immutable pack under a unique ID.
3. Upload its immutable index.
4. Publish an immutable catalogue delta which registers the pack.
5. Upload the encrypted Metadata batch.
6. Publish the batch commit manifest last.
7. Advance the local send checkpoint only after the commit manifest succeeds.

A failure before step 6 may leave unreachable objects, but it does not publish Metadata with unavailable Chunk
references. A retry can reuse verified immutable objects or publish replacements under new IDs. Later maintenance can
remove unreachable incomplete publications.

### Native CAS publication

PostgreSQL can perform Chunk insertion, required-Chunk verification, Metadata batch insertion, and commit publication
inside a transaction. The external semantics remain equivalent to the object-store commit-manifest sequence.

### Receive

1. List committed Metadata batches after the local cursor.
2. Decrypt and validate Metadata events.
3. Collect all referenced Chunks missing from the local database.
4. Call `getMany` once per bounded byte and count window.
5. Let the Chunk Store group object-store requests by pack or issue a native batch RPC.
6. Validate and persist Chunks.
7. Apply Metadata revisions through the maintained PouchDB revision contract.
8. Advance the receive checkpoint only after the batch reaches its terminal state.

A commit manifest may include non-authoritative location hints for newly published Chunks. Metadata continues to refer
only to logical Chunk IDs so that repacking never changes file revisions.

## Concurrency and failure model

Ordinary publication is multi-writer and append-only:

- pack IDs, delta IDs, and batch IDs must be globally collision-resistant;
- concurrent publication of the same logical Chunk may create physical duplicates;
- catalogue additions merge without a last-write-wins replacement;
- failed uploads remain unreachable until maintenance removes them; and
- retries are idempotent at the logical Chunk and Metadata revision boundaries.

Physical retirement and deletion require stronger coordination than addition. A compactor must use a bounded lease or
fencing token appropriate to the remote. A stale compactor may upload a redundant replacement pack, but it must not
publish a retirement or delete an object after losing its authority.

The protocol must test each failure boundary independently: pack upload, index upload, catalogue delta publication,
Metadata upload, commit publication, checkpoint persistence, snapshot publication, retirement, and deletion.

## Encryption and privacy

The current whole-pack encryption can hide document IDs, Chunk IDs, and pack contents from the storage service. Native
CAS and searchable pack indexes introduce different leakage, so they require an explicit threat-model review.

The remote Chunk key should be an opaque Vault-scoped derivation rather than a raw content hash. One candidate is:

```text
remoteChunkKey = HMAC(vaultChunkIdentityKey, localChunkID)
```

This prevents correlation of the same content across independent Vaults while preserving equality and deduplication
inside one Vault. It still reveals within-Vault equality, object count, sizes, and access patterns to the remote.

For byte-range pack reads, each Chunk record must be encrypted and authenticated independently. Encrypting one complete
pack as a single AEAD value would require downloading the complete pack before authenticating or decrypting one range.
The pack header and index must be authenticated, and the design must define whether the object-store catalogue itself
is encrypted.

PostgREST needs server-visible opaque keys to execute a multi-key query. It does not need plaintext file paths, local
Chunk hashes, or decrypted content.

Credential rotation must not change remote Chunk identity. Rotation of the Vault Chunk identity key is a data migration
which creates a new namespace and cannot be treated as an ordinary bearer-token or password change.

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

The existing remote layout and the adaptive layout should use disjoint prefixes or schemas during experimentation. An
opt-in test Vault may rebuild into the adaptive representation, but an ordinary upgrade must not migrate or delete an
existing remote implicitly.

The compatibility plan must define:

- negotiation between old and adaptive clients;
- rollback before and after the first adaptive commit;
- coexistence or exclusion rules for mixed client versions;
- checkpoint identity and epoch changes;
- remote reset behaviour;
- encryption-key and Chunk-identity-key migration; and
- exact conditions which require Fetch, Rebuild, or a new remote profile.

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

Initial thresholds must be conservative and observable. Candidate inputs include pending byte count, pending Chunk
count, expected pack reuse, range-read capability, and an upper bound on one RPC or pack response. Provider names alone
must not become performance policy.

## Planned implementation stages

### Stage 0: Executable model

- Define the repository, Chunk Store, catalogue, and commit state machines independently of a transport.
- Add property and fault-injection tests for publication ordering, retry, duplicate physical locations, and recovery.
- Record the threat model and remote-visible metadata.

### Stage 1: Native batch CAS experiment

- Add disposable PostgreSQL/PostgREST RPCs for batched Chunk availability, insertion, retrieval, and Metadata commit.
- Measure RPC framing, transaction size, memory, and proxy limits.
- Verify Vault isolation and failure rollback through real service integration tests.

### Stage 2: Immutable object-pack experiment

- Define a versioned, independently encrypted Chunk-record pack format.
- Implement catalogue deltas and a local derived catalogue.
- Compare S3-compatible range reads with WebDAV whole-pack fallback.
- Validate bounded request behaviour without per-Chunk `HEAD` or `GET` loops.

### Stage 3: Snapshot and compaction

- Add catalogue snapshots, retirement records, fencing, grace conditions, and recovery.
- Implement conservative repacking without Metadata rewrites.
- Exercise concurrent writers and interrupted compactors.

### Stage 4: Consumer integration

- Extend Chunk retrieval with an explicit Adaptive Journal producer and terminal-condition contract.
- Add multi-device Commonlib integration, CLI consumption, and focused real-Obsidian tests.
- Define opt-in migration, rollback, diagnostics, and maintenance controls.

### Stage 5: Release decision

- Compare the adaptive paths with the current opaque Journal baseline.
- Review privacy, corruption recovery, storage amplification, and operational complexity.
- Select supported strategies and thresholds only after the evidence is available.

## Test obligations

- Metadata is never committed before all newly required Chunks have a durable source.
- One logical Chunk ID never resolves to different accepted plaintext bytes.
- Batch retry, duplicate physical storage, and concurrent publication are idempotent.
- Native CAS batch limits are enforced by count and bytes.
- Object-pack retrieval groups requests by pack and avoids per-Chunk network loops.
- Range and whole-pack retrieval produce identical validated Chunk results.
- Catalogue reconstruction from snapshots and deltas is deterministic.
- A stale snapshot hint cannot hide later valid deltas.
- Interrupted snapshotting, repacking, retirement, and deletion preserve readable data.
- Every protected Metadata winner and live conflict branch remains reconstructible.
- Direct Chunk delivery integrates with the maintained waiting and finite-activity boundaries.
- Vault-scoped access and opaque remote Chunk identity prevent cross-Vault retrieval.
- Mixed protocol versions fail closed before publishing incompatible Metadata.

## Open decisions

- Which Vault secret, derivation, and rotation contract should produce remote Chunk keys?
- Is the object-store catalogue encrypted, and which non-secret header remains listable?
- What exact pack framing supports independent authentication and efficient range reads?
- Should a small urgent publication always be a micro-pack, or may it use a loose immutable Chunk object?
- How are catalogue delta frontiers represented without relying on wall-clock ordering?
- Which conditional-write, lease, or fencing mechanisms form the portable minimum across S3-compatible storage and
  WebDAV?
- What reachability and retention policy protects non-live revision history?
- What payload and response framing lets PostgREST stream large bounded batches safely?
- When does PostgreSQL `bytea` remain appropriate, and when should a PostgREST deployment use an external object store?
- Which benchmark results justify adaptive thresholds rather than one fixed strategy per remote?

These decisions remain Planning work. No implementation stage should silently choose them through incidental adapter
behaviour.
