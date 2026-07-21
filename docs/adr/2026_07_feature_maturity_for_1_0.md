# Feature maturity for 1.0

## Status

Proposed for the 1.0 integration branch.

## Context

Self-hosted LiveSync accumulated several labels such as 'experimental', 'Beta', 'obsolete', and 'sunset' over the 0.x line. Those labels did not consistently describe the current implementation. Some formerly experimental features now have maintained unit, Compose, and real-Obsidian coverage, while some old database-format options remain executable only because existing data must still be opened safely.

Version 1.0 needs to distinguish supported opt-in features from previews and from compatibility paths. Removing a label does not make a network environment reliable, and retaining a setting key does not make it a recommendation.

## Decision

### Supported opt-in features

- Peer-to-Peer Synchronisation is supported. Commonlib owns the transport lifecycle, the Compose suite covers transfer, replacement, disconnect, and reconnect behaviour, and the Obsidian host verifies its current pane boundary. Documentation must describe environmental WebRTC limitations without calling the feature experimental.
- Hidden File Sync is supported as an advanced, separately initialised feature. It remains disabled during ordinary Setup URI initialisation and has its own two-Vault, conflict, filtering, and notification acceptance workflow.
- Customisation Sync is supported as an advanced opt-in feature. Its maintained two-Vault real-Obsidian workflow covers snippets, configuration files, and plug-in files, including updates and deletion of source synchronisation data. It remains separate from Hidden File Sync and must not manage the same files concurrently.
- Data Compression is maintained as an advanced opt-in storage and bandwidth trade-off. It remains disabled by default. The three-repeat CLI and CouchDB benchmark reduced stored chunk data and upload bodies by about 9% for the mixed fixture, but processing and worker-memory costs remained substantial. The [Data Compression specification](../specs_data_compression.md) records the contract, measurements, compatibility behaviour, execution model, and reproduction path for future default-setting decisions.
- The real-Obsidian E2E runner is maintained release infrastructure rather than an experimental Harness.

### Retained previews

- JWT authentication remains experimental because it depends on specialised CouchDB server configuration and does not yet have a maintained server-backed authentication matrix. The current implementation, Setup URI transport, focused unit coverage, and reported ES512 use justify retaining it.
- Ignore files remain Beta. They have focused target-filter tests, but nested rules, hidden-file expectations, and open user reports still require review.
- Automatic newer-file conflict resolution remains Beta and disabled by default because it can deliberately overwrite one side of a conflict.
- Garbage Collection V3 remains Beta and explicitly initiated. Its algorithm and safety protocol are outside this classification change and require a separate decision.

### Compatibility-only and sunset paths

- E2EE V1 and its dynamic iteration-count setting remain for existing encrypted databases. E2EE V2 is the new-Vault contract.
- The old IndexedDB adapter remains only with its migration path back to IDB.
- `xxhash64` is the current hash contract. Other hash algorithms remain available for existing databases and edge-case recovery, not as experimental alternatives for new Vaults.
- Eden chunks remain accepted at runtime and in transported settings, but are not offered in the settings interface.
- `doNotUseFixedRevisionForChunks` remains an inert compatibility input. Chunk revisions are always content-derived.
- The deprecated cleaned-database reconciliation callback remains internal while an old IndexedDB client may still encounter that remote state. It is not a user-selectable maintenance action and is omitted from the settings reference.

### Already removed

The obsolete mocked browser Harness, automatic bulk chunk pre-send, legacy trash toggle, and fixed-revision control have no supported 1.0 UI path. Their compatibility data, where required, remains accepted independently of their removed controls.

## Consequences

- Supported opt-in features retain focused release gates and user documentation.
- Preview features remain off by default and keep explicit maturity labels.
- Compatibility-only settings must not silently change existing data formats. New configuration should not expose retired formats merely because their decoders remain available.
- Commonlib setting types and Setup URI decoding remain broad enough to read existing configurations. Removing those package contracts requires a separately versioned compatibility decision.
- Deprecated host accessors and Community directory API warnings are a separate refactoring boundary. This decision does not authorise removing broadly used internal access paths.
