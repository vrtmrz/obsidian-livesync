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
date: 5 September 2026
bibliography: paper.bib
---

# Summary

Self-hosted LiveSync is an open-source synchronisation plug-in for Obsidian [@obsidian], a note-taking application that stores documents as local Markdown files. It replicates a user's vault—a directory containing notes and attachments—across desktop and mobile devices using user-controlled storage or direct peer-to-peer connections.

The plug-in allows users to continue editing offline and synchronise upon reconnection, even when conflicting edits arise—such as when two disconnected devices modify the same note concurrently. Rather than forcing immediate reconciliation or unconditionally overwriting competing changes, the system supports automatic merging of non-overlapping edits and preserves competing versions for deferred review, depending on file formats and configured policies. Built-in inspection tools help users investigate conflicts or missing content and recover files when surviving copies exist.

The software serves researchers, engineers, and practitioners who require continued note-taking across multiple devices while controlling their data storage.

# Statement of Need

Research and engineering workflows depend on long-lived notes, observations, design decisions, and supporting files. The author's work required managing the software installed on each device, keeping files on infrastructure under personal control, and using server software with an established operational record. These constraints motivated a synchronisation engine running directly inside Obsidian across desktop and mobile platforms without external client daemons.

Conflicts arising from concurrent edits on disconnected devices are recognised only after devices exchange updates. An edit or deletion may be unintended, concurrent modifications may diverge, or external tools may update files independently of database events. Overwriting with a single version without retaining competing revisions risks irreversibly discarding information before users can evaluate the divergence.

During fieldwork and mobile operations, researchers and practitioners often need to continue recording observations and transferring notes between devices before reviewing competing edits. Self-hosted LiveSync supports this separation of recording and reconciliation: replication proceeds while concurrent branches remain unresolved, protecting competing edits until they can be reviewed or resolved according to configured policies.

# State of the Field

Local-first software combines local availability with multi-device synchronisation and collaboration while avoiding dependence on a hosted service as the sole owner of user data [@kleppmann2019localfirst]. Within the Obsidian ecosystem, Obsidian Sync provides an integrated hosted service [@obsidiansync]; Obsidian Git provides version-control-oriented push and pull workflows [@obsidiangit]; Syncthing operates at the filesystem layer [@syncthing]; and Remotely Save connects Obsidian to several cloud and self-hosted storage APIs [@remotelysave].

These approaches differ in how they represent concurrent changes. Syncthing propagates conflict copies as ordinary files [@syncthingsync], while Git can fetch divergent histories into separate tracking branches before merging them [@gitfetch], an approach automated on desktop and mobile by Obsidian Git [@obsidiangit]. Conflict-free replicated data types (CRDTs) can also expose alternatives: Automerge retains concurrent assignments to an object property for inspection [@automergeconflicts]. Self-hosted LiveSync retains competing file versions as leaves—the current versions of divergent branches—in the metadata document's revision tree until resolved by configured policies or explicit user action.

These existing tools address distinct operational needs: hosted services prioritise turnkey convenience, external file synchronisers manage arbitrary filesystem trees, and version-control tools introduce explicit commit workflows. In the author's environment, however, managed devices prohibited background client daemons, while retaining competing revisions alongside their associated file updates required integrating replication directly with local file operations. Self-hosted LiveSync was therefore implemented as an Obsidian plug-in running entirely within the application runtime, backed by a decoupled, platform-independent engine to maintain uniform revision semantics across backends.

Self-hosted LiveSync does not introduce a new database replication algorithm; rather, its contribution lies in applying revision-aware database semantics to an externally editable file vault. Content-addressed chunks, device-local branch provenance, and built-in recovery tools support continued editing while conflict review is deferred, protecting divergent work without altering standard note-taking workflows.

# Software Design

The shared replication and conflict-handling services are published as `@vrtmrz/livesync-commonlib` [@commonlib021] and used by the Obsidian plug-in, command-line interface (CLI), web application, and web peer.

## Revision-aware Vault representation

Each Vault file is represented in local PouchDB [@pouchdb] by a metadata document containing its path, size, modification time, and references to separate chunk documents. Chunks are content-addressed and can therefore be reused across revisions and files with identical content regions. When concurrent updates occur across devices, they form multiple competing leaves around the metadata document. PouchDB selects a deterministic winner for default retrieval, but this choice is an internal tie-breaker rather than evidence that the winner is newer, safer, or the version represented by a particular device's Vault.

When concurrent updates diverge into branches $\alpha$ and $\beta$, both leaves replicate to other devices before resolution. Automatic three-way merging applies to Markdown (`.md`), Canvas (`.canvas`), and JSON (`.json`) files when both leaves and their nearest available shared ancestor are readable; other formats are excluded. In Markdown, concurrent insertions at the same offset concatenate sequentially by modification time. Because CouchDB replication transfers ancestry identifiers without ancestor content [@couchdbreplication], missing ancestral history or conflicting edits defer automatic merging. When automatic merging is disabled or inapplicable and both versions are readable, JSON and differing binary files resolve by modification time as a compatibility fallback, even when 'Always overwrite with a newer file' is disabled; enabling that option extends modification-time resolution to text conflicts. Otherwise, competing text versions remain for manual resolution, and can be compared via a two-way diff when both leaves are readable.

## Device-local branch provenance

While the database can retain competing branches concurrently, a local Vault can instantiate only a single concrete file at any given path. To resolve which branch a local file represents, the plug-in stores an exact database revision and observed local modification time in a device-local key-value store. This revision serves as the path's **branch anchor**, updated after a successful database-to-Vault reflection or Vault-to-database write.

During active conflicts, local edits or logical deletions become children of the anchored revision, advancing that branch while keeping competing leaves intact. Cross-path renames store the target before logically deleting only the anchored source branch. If provenance is unavailable, the plug-in binds a file to an existing revision only when its bytes match exactly one available revision body; otherwise, it retains the conflict for manual resolution rather than guessing from paths or timestamps. Without active conflicts, ordinary writes simply advance the database revision.

The built-in conflict inspector examines the current winner, every conflict leaf, and the nearest available shared ancestor. It reports missing chunks and file/database differences, permitting operations on an explicitly selected current leaf. Mutating operations recheck the revision beforehand, preventing a stale inspection from deleting or extending a superseded branch.

## Transport-independent replication

Using CouchDB's revision model as a baseline, Self-hosted LiveSync decouples database representation from network transport, replicating file-metadata revision identifiers and competing leaves intact across backends. CouchDB [@couchdb] provides native revision-aware replication. S3-compatible storage journals metadata leaf revisions and ancestry identifiers without synthesising new revisions, while chunk documents are stored as new local revisions with content-derived identifiers. The WebRTC peer-to-peer (P2P) adapter [@webrtc] uses Trystero [@trystero] DataChannels and an RPC-based replication shim to batch document requests while preserving identical revision semantics directly between peers. In CouchDB and journal transfers, Web Streams pipeline data to limit the amount of data buffered in memory during transfer.

Transports combine flexibly: while P2P requires concurrent online presence, pairing it with CouchDB or object storage bridges offline intervals. All transports support end-to-end content encryption and path obfuscation. P2P encrypts session descriptions during connection negotiation, though signalling relays and network services can still observe connection timing and network addresses.

## Retention and recovery

Because alternative branches share unchanged chunks, retaining competing leaves incurs storage and transfer costs primarily for new chunks and revision metadata. Remote database rebuilds reclaim space, while an explicitly initiated beta garbage-collection workflow provides in-place CouchDB cleanup by protecting chunks reachable from the current winner, every conflict leaf, and the available ancestry needed to inspect active conflicts. Because superseded chunks may be collected, historical revisions are not an unconditional backup.

When chunks are missing, unreadable current revisions remain in the tree rather than being automatically discarded during conflict processing. Because missing chunks may still exist on other devices, users can defer recovery until they reconnect and synchronise. The conflict inspector identifies affected revisions and facilitates retrieval retries and explicit recovery actions. Recovery ultimately requires surviving content on a device, in remote storage, or in a backup.

# Research Impact Statement

Self-hosted LiveSync originated in the author's multi-platform software engineering workflows, capturing screenshots and recording observations across multiple devices, including when a primary device was unavailable. Today, the same workflow supports the author's patent prior-art investigations, synchronising notes and reflections made while reading prior patent literature. Retaining competing revisions allows divergent observations to be compared after the fact rather than overwritten immediately.

Unit and integration tests cover revision ancestry, chunk reachability, unavailable content, and host composition. CLI and real-Obsidian scenarios exercise conflict propagation and resolution, including edits, logical deletions, and renames while competing leaves remain active. A three-node P2P scenario verifies that unresolved leaves move between devices before resolution. Reusable headless test infrastructure is archived independently [@fancykit]. Deterministic fixtures compare P2P and CouchDB paths over identical generated data; controlled local measurements do not establish universal performance.

As of 2 September 2026, the Obsidian plug-in directory reported more than 900,000 downloads, desktop and mobile support, and placement in its Research category [@obsidianplugin]. The GitHub repository recorded over 12,200 stars, 440 forks, and contributions from a broad user community [@selfhostedlivesyncrepo]. These figures demonstrate community adoption rather than direct research impact, but they provide evidence that the software operates beyond a single private workflow.

The software described here is Self-hosted LiveSync 1.0.23 [@selfhostedlivesync], released under the MIT licence and pinned to Commonlib 0.1.21 [@commonlib021]. Zenodo archives the plug-in, the reusable test harness [@fancykit], and an earlier Commonlib 0.1.19 snapshot [@commonlib]. Platform-independent logic supports independent testing and reuse.

# AI Usage Disclosure

OpenAI Codex using GPT-5 was used from July to September 2026 for code navigation, test and benchmark scaffolding, CI and documentation edits, manuscript editing, proofreading, review, citation verification, and result summarisation. GPT-6 assisted with September manuscript review and revision through Codex. No other generative AI tools prepared the manuscript. GitHub Copilot assisted with commits in this release, and Google Gemini (Flash versions 3.5 to 3.8) supported codebase verification. The human author validated all assisted outputs, made core design decisions, ran verification commands, and remains responsible for the accuracy, originality, licensing, and ethical compliance of the submitted materials.

# Acknowledgements

The author acknowledges project contributors, users, and upstream maintainers of PouchDB, CouchDB, and Trystero. The project has received community support through GitHub Sponsors, development-tool licensing from JetBrains, and support through OpenAI's Codex for Open Source programme.

# References

