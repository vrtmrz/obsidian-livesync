---
title: 'Self-hosted LiveSync: Inspectable and recoverable replication for local-first Obsidian vaults'
tags:
  - local-first software
  - synchronisation
  - CouchDB
  - PouchDB
  - WebRTC
  - Obsidian
  - TypeScript
authors:
  - name: 'vorotamoroz'
    affiliation: 1
    corresponding: true
affiliations:
  - name: 'Independent Researcher'
    index: 1
date: 7 November 2026
bibliography: paper.bib
---

# Summary

Self-hosted LiveSync is an open-source synchronisation plug-in for Obsidian [@obsidian], which stores notes as local Markdown files. It replicates a user's vault—a directory containing notes and attachments—across desktop and mobile devices via self-hosted storage or direct peer-to-peer connections.

Users can edit offline and synchronise upon reconnection, even after concurrent edits to a note. Rather than forcing immediate reconciliation or unconditionally overwriting changes, the plug-in merges non-overlapping edits automatically or retains competing versions for deferred review by format and policy, with inspection tools for conflict analysis and recovery when surviving copies exist.

The software serves researchers, engineers, and practitioners requiring multi-device note-taking under self-managed storage.

# Statement of Need

Research and engineering workflows rely on long-lived notes, observations, design records, and attachments. The author's work required managing the software installed on each device, keeping files on self-managed infrastructure, and using server software with an established operational record. These constraints motivated an in-app synchronisation engine running directly inside Obsidian across desktop and mobile platforms without external client daemons.

Concurrent edits on disconnected devices surface only when updates are exchanged. Because unintended edits or deletions, divergent changes, or external modifications can occur outside database events, overwriting with one version without retaining competing revisions risks discarding information before review.

During fieldwork and mobile use, users often record and transfer notes before reviewing conflicts. Self-hosted LiveSync separates recording from reconciliation: replication continues while concurrent branches remain unresolved until reviewed or resolved by policy.

# State of the Field

Local-first software combines local availability with multi-device synchronisation without a hosted service as sole data owner [@kleppmann2019localfirst]. For Obsidian, Obsidian Sync offers a hosted service [@obsidiansync], Obsidian Git provides Git workflows [@obsidiangit], Syncthing synchronises filesystem trees [@syncthing], and Remotely Save connects to cloud and self-hosted storage APIs [@remotelysave].

These tools represent concurrency differently: Syncthing propagates conflict copies as ordinary files [@syncthingsync], Git fetches divergent histories into tracking branches before merging [@gitfetch] (automated by Obsidian Git [@obsidiangit]), and CRDTs such as Automerge retain concurrent property assignments [@automergeconflicts]. Self-hosted LiveSync retains competing file versions as leaves—current versions of divergent branches—in the metadata revision tree until resolved.

Hosted services prioritise convenience, external synchronisers manage raw filesystems, and version-control tools use explicit commits. In the author's environment, however, managed devices prohibited background client daemons, while retaining competing revisions alongside their associated file updates required coupling replication directly with local file operations. Self-hosted LiveSync was therefore implemented to run in-app inside Obsidian over a decoupled, platform-independent engine with uniform revision semantics.

Rather than proposing a new replication algorithm, Self-hosted LiveSync applies revision-aware database semantics to an externally editable vault, using content-addressed chunks, device-local provenance, and inspection tools to support editing while conflict review is deferred.

# Software Design

Shared replication, conflict-handling, and logical path-identity services are published as `@vrtmrz/livesync-commonlib` [@commonlib040] for the Obsidian plug-in, command-line interface (CLI), web application, and web peer, separating shared logical namespaces and path comparisons from host-owned physical file operations.

## Revision-aware Vault representation

Each Vault file is stored in local PouchDB [@pouchdb] as a metadata document recording its path, size, modification time, and references to content-derived chunks from the V3 Rabin–Karp rolling-hash splitter by default, reusing unchanged chunks across revisions and files. Concurrent updates form competing leaves around the metadata document; PouchDB's deterministic default winner does not prove that branch is newer, safer, or displayed in the Vault.

When concurrent updates diverge into branches $\alpha$ and $\beta$, both leaves replicate before resolution. Automatic three-way merging applies to Markdown (`.md`), Canvas (`.canvas`), and JSON (`.json`) files when both leaves and their nearest available shared ancestor are readable (same-offset Markdown insertions concatenate by modification time). Because CouchDB replication transfers ancestry identifiers without ancestor bodies [@couchdbreplication], missing ancestor content or overlapping edits defer automatic merging. Without automatic merging, readable JSON and differing binary conflicts resolve by modification time even with 'Always overwrite with a newer file' disabled; that option extends modification-time resolution to text conflicts, which otherwise await manual two-way diff resolution.

## Device-local branch provenance

While the database retains competing branches, a Vault instantiates one file per path. After database-to-Vault reflection or Vault-to-database writes, the plug-in records the database revision, local modification time, SHA-256 hash, and byte length in a device-local store.

This **branch anchor** tracks the displayed branch across saves and conflicts. Matching the readable recorded revision or saved hash and size shows a Vault file is unchanged—even after pruning that revision body—so unedited local files do not overwrite newer database state.

When local bytes differ from the readable recorded revision, edits extend that anchored branch while keeping competing leaves intact. Without readable provenance or matching content evidence, saves and reflection check current non-deleted leaves rather than ancestors: a unique match reconstructs provenance, multiple matches avoid duplicate writes without identifying a displayed branch, and no match preserves an independent conflict branch rather than guessing from paths or timestamps. During conflicts, deletions logically delete the proven displayed branch (or retain all branches if unproven), case-only renames resolving to the same document ID extend the displayed branch in place, and cross-path renames write the target before logically deleting only the proven source branch. Provenance is device-local evidence, not an atomic transaction or missing-ancestor substitute; after an interrupted save, start-up replay converges duplicates or defers concurrent updates to merge or review in tested scenarios.

The conflict inspector examines the winner, every conflict leaf, and the nearest available shared ancestor, rechecking revisions before mutating actions so stale views cannot delete or extend superseded branches. A read-only integrity diagnostic compares metadata and active conflicts across the Vault, local database, and CouchDB, distinguishing uninspected from verified content with optional pseudonymised reporting.

## Transport-independent replication

Using CouchDB's revision model, Self-hosted LiveSync decouples database representation from transport, replicating metadata revision IDs and competing leaves intact. CouchDB [@couchdb] provides native revision-aware replication; Fast Setup verifies and retains all competing leaves—including logically deleted branches—and hands eligible fresh fetches to ordinary replication. S3-compatible storage journals metadata leaf revisions and ancestry identifiers without synthesising new revisions, storing content-addressed chunks. The WebRTC peer-to-peer (P2P) adapter [@webrtc] batches requests over Trystero [@trystero] DataChannels and an RPC shim while preserving revision semantics, and Web Streams pipeline CouchDB and journal transfers.

Transports combine when synchronising clients share a path-identity mode, pairing P2P with CouchDB or object storage across offline intervals. On supported filesystem hosts (Obsidian and the CLI), optional Unicode NFC path identity equates composed (NFC) and decomposed (NFD) path spellings into one logical path identity across CouchDB, object storage, and P2P without renaming physical files or changing chunk IDs, while keeping letter-case handling separate [@livesyncnfc1046]. Existing setups retain their configured mode by default, and migrating a legacy database to NFC requires resolving collisions before an explicit rebuild and peer fetch [@livesyncrecovery1046].

All transports support end-to-end encryption, path obfuscation, and an optional independent ID key; on CouchDB with required encryption settings, new writes encrypt internal synchronisation metadata properties, while document IDs, revision structure, document counts, and P2P relay metadata remain observable.

## Retention and recovery

Because divergent branches share unchanged chunks, retaining competing leaves adds storage and transfer costs mainly for new chunks and revision metadata. Remote rebuilds reclaim space, while an explicit beta garbage-collection workflow cleans CouchDB in place by protecting chunks reachable from the winner, every conflict leaf, and available conflict ancestry; because superseded chunks may be collected, historical revisions are not an unconditional backup.

When chunks are missing, unreadable current revisions remain in the tree during conflict processing, deferring recovery until surviving copies reconnect. Likewise, during S3-compatible journal reception, decode, processing, or local-save failures halt replication before advancing the checkpoint so that retrying can re-receive the failed journal within the retained remote journals [@livesyncrecovery1046]. Recovery workflows and the conflict inspector assist retries and recovery when surviving copies exist.

# Research Impact Statement

Self-hosted LiveSync originated in the author's multi-platform software engineering workflows, capturing screenshots and recording observations across devices even when a primary device was unavailable. Today, the same workflow also supports the author's patent prior-art investigations, synchronising notes and reflections while reviewing patent literature and retaining competing revisions for later comparison rather than overwriting them immediately.

Test procedures in 1.0.46 [@livesynctest1046] cover revision ancestry, provenance reconstruction, chunk reachability, unavailable content, CLI and real-Obsidian conflict propagation and resolution (edits, logical deletions, renames, interrupted saves, and start-up reconciliation), and three-node P2P leaf transfer, alongside the Unicode NFC acceptance matrix and dated Linux milestone E2E verification across CouchDB, object storage, and P2P [@livesyncnfc1046]. Public CI for 1.0.46 [@livesyncci1046] confirms automated unit, contract, and CLI/Docker suites with Commonlib 0.4.0 [@commonlib040], without claiming real-Obsidian milestone E2E reruns on 1.0.46 or native iOS/macOS filesystem validation. Archived headless infrastructure [@fancykit] and deterministic fixtures compare P2P, CouchDB, and chunking paths without claiming universal performance.

As of 2 September 2026, the Obsidian plug-in directory reported over 900,000 downloads, desktop and mobile support, and placement in its Research category [@obsidianplugin], with over 12,200 GitHub stars, 440 forks, and community contributions [@selfhostedlivesyncrepo]. These figures indicate community adoption rather than direct research impact, providing evidence that the software operates beyond a single private workflow.

The software described here is Self-hosted LiveSync 1.0.46 [@selfhostedlivesync1046], released under the MIT licence and pinned to Commonlib 0.4.0 [@commonlib040]. Zenodo archives earlier snapshots of the plug-in [@selfhostedlivesync] and Commonlib [@commonlib], alongside the test harness [@fancykit].

# AI Usage Disclosure

OpenAI Codex (GPT-5 and GPT-6) was used from July to November 2026 for code navigation, test and benchmark scaffolding, CI and documentation edits, and manuscript drafting and review. GitHub Copilot assisted with commits, and Google Gemini (Flash 3.5–3.8 and Gemini 4) supported codebase verification and manuscript revision. The author validated all outputs, made core design decisions, ran verification, and remains responsible for the accuracy, originality, licensing, and ethical compliance of the submission.

# Acknowledgements

The author thanks contributors, users, and maintainers of PouchDB, CouchDB, and Trystero, alongside GitHub Sponsors, JetBrains tool licensing, and OpenAI's Codex for Open Source programme.

# References
