---
date: 2026-11-03
commonlib-version: "0.2.3"
self-hosted-livesync-version: "1.0.44"
status: accepted-unreleased
---

# Architectural Decision Record: Separate Document Representations and Operation Contracts

## Status

Accepted, with an unreleased local implementation. The investigated baseline
is Self-hosted LiveSync `1.0.44` with Commonlib `0.2.3`. Implementation review
also examined Commonlib `0.3.0`; the original baseline is retained. The
[design document](../design_docs/document_and_chunk_type_contracts.md#implementation-decisions-and-remaining-work)
records the selected API surface, compatibility staging, and remaining work.

The review reproduced a difference between direct and path reads of the
oldest inline format. Its repair was explicitly approved: path reads retain
the inline body until the existing legacy reconstruction runs. DFM path and
ID admission policies also remain distinct, and existing content-interpretation
rules retain differing `type` and `datatype` inputs.

The proposal complements the accepted
[Commonlib package boundary](2026_07_common_library_package_boundary.md).
It does not replace the current [data-structure reference](../datastructure.md),
[Chunk retrieval contract](../design_docs/chunk_retrieval_and_waiting.md), or
[revision-provenance contract](../specs_conflict_resolution.md).

## Context

The document types combine persisted file formats, compatibility formats,
save inputs, reconstructed content, and PouchDB response information through
overlapping unions and intersections. Several names are structurally
equivalent. `LoadedEntry` can describe a Metadata-only result with placeholder
content, while `SavingEntry` inherits fields which the save operation has not
yet produced.

Functions which only inspect paths or deletion markers require complete entry
types. Other boundaries declare content which their callers do not provide.
Type assertions bridge those mismatches without explaining the actual
preconditions and results of the operation.

DFM defines its own current `MetaEntry` and `ReadyEntry`. Its array-content
guarantee differs from the broader Commonlib `LoadedEntry`, and the return
types do not express the relationship between `metaOnly` and content
availability. Replacing one name with another would change those guarantees.

Some guards claim a complete document after checking only a discriminator,
property presence, or an ID prefix. Other apparently weak checks preserve an
intentional compatibility contract: the Chunk response classifier accepts ID
and content without requiring a `leaf` discriminator. A uniform strict
validator would change accepted behaviour.

The [design document](../design_docs/document_and_chunk_type_contracts.md)
records the pinned source evidence, current relationships, function matrix,
and verification requirements.

## Decision

### 1. Share information views and distinguish operation contracts

Keep small interfaces for shared identity, path, file attributes, and deletion
state. Functions accept those views when that information is sufficient.
Use unions for document alternatives and composed types for complete operation
inputs and results. Do not convert every object type alias to an interface.

Separate save inputs and content reconstruction results from stored-document
variants. A content-bearing value may satisfy a Metadata information view,
but that view does not establish that the whole value is suitable for storage.
Keep explicit construction of persisted Metadata and separate Chunk content.

Distinguish an identified value from a revision-bearing response, a logical
deletion from a tombstone, and a decoded application value from raw transport
input. Document unions state their store or transport scope; they do not
implicitly grant replication or reflection eligibility.

### 2. Align Commonlib, DFM, and consumer boundaries

Commonlib owns canonical shared types, validators, normalisation, reconstruction,
and the DFM contracts. DFM and Self-hosted LiveSync use those definitions rather
than maintaining parallel domain models. Product-specific projections remain
with their owning consumer.

Retain DFM's current array-content guarantee and distinguish Metadata selection
from content callbacks. Express the relationship between a read mode and its
result. Keep compatibility names or adapters where they preserve an existing
contract; do not widen guarantees merely to collapse names.

Preserve current-state re-reading in ordinary reflection and the explicit
selected-revision contract in history restoration. Check every maintained
service handler before narrowing a shared callback.

### 3. Validate only what the resulting type promises

Use shared validators with detailed failures, Boolean guards, and assertion
wrappers as appropriate. A discriminator-only guard operates on an already
validated union; validation of unknown input establishes every property which
its result promises.

Keep decoding and compatibility normalisation as value-producing operations.
Successful reconstruction produces the content result. A shape assertion
cannot certify that content was fetched, persisted, or matched to the Vault.
Revision freshness, ancestry, provenance, and destructive-operation authority
remain with the existing authoritative checks and rechecks.

Preserve accepted legacy and minimal retrieval inputs. Any stricter acceptance
rule or canonicalisation with observable effects is a separate behavioural
decision, not an incidental consequence of a type refactor.

### 4. Migrate through the package boundary

Implement shared contracts in the Commonlib repository, validate its exact
packed artefact, and update the consumer's exact dependency before integrating
the corresponding Self-hosted LiveSync changes. Retain the agreed public and
compatibility contracts during migration. This decision adds no persistent
state, wire-format change, automatic repair, or database migration.

## Alternatives considered

| Alternative | Assessment |
| --- | --- |
| Rename or convert declarations without changing contracts | Leaves placeholder content, redundant save fields, and overstated predicates in place. |
| Retain one entry hierarchy for every processing stage | Continues to make save inputs and loaded content appear to be stored-document variants. |
| Give every helper a complete document union | Requires unrelated fields and encourages casts at information-only boundaries. |
| Use one strict assertion for every incoming document | Conflates raw and decoded shapes, rejects supported compatibility inputs, and mishandles body-less tombstones. |
| Keep DFM's domain model independent | Preserves duplicated definitions without a distinct domain ownership reason. |
| Replace authoritative reads with validated or branded snapshots | Cannot preserve current-leaf, provenance, or concurrent-storage guarantees after state changes. |

## Consequences and follow-ups

Callers can state whether they supply a reference, Metadata, save content,
or reconstructed content. Invalid assumptions become visible in declarations
and focused contract tests. This does not itself establish an end-user defect
or eliminate the need for runtime validation and recovery checks.

More explicit types require adapters at the compatibility boundaries and
coordinated package and consumer changes. The design document records the
implemented information views, legacy correction, static content exclusion,
and DFM read methods. Old entry aliases, the broad document union, and the
Chunk write/event adapter remain compatibility boundaries. A complete
store-specific union and Chunk hierarchy migration remain follow-ups.

Before changing production behaviour, add the relevant regression and
compatibility cases and establish their baseline outcomes. Validate save
ordering, accepted legacy inputs, empty content, tombstones, DFM callbacks,
and revision/provenance behaviour. Update this status and the supporting
references when the decision is accepted, implemented, or published; preserve
the investigated baseline and any remaining follow-ups.
