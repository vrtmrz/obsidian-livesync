# Documentation index

Choose a document by the task and its status. User guides describe supported operations; implementation references describe contracts and their limits; ADRs record why a decision was made. Proposals and historical designs are grouped separately below.

A document's original date and reviewed-version fields describe its baseline. Read its implementation or publication note before treating that baseline as the current release. A published feature does not by itself establish that every proposal or validation step in its design is complete.

## Setup and everyday use

| Task | Start here |
|---|---|
| Get started | [What you need](../README.md#what-you-need), then [Start synchronising](../README.md#start-synchronising) |
| Choose a CouchDB setup | [Own server](setup_own_server.md), [Docker stack](../docker/README.md), [Fly.io](setup_flyio.md), or [IBM Cloudant (managed)](setup_cloudant.md) |
| Configure CouchDB clients | [Quick setup](quick_setup.md) |
| Find hosting services proposed by the community | [Third-party hosting listings](../README.md#hosting-services-proposed-by-the-community) |
| Set up S3-compatible storage | [Object Storage Setup](setup_object_storage.md) |
| Set up peer-to-peer synchronisation | [P2P communication model](p2p.md), then [Peer-to-Peer Setup](setup_p2p.md) |
| Diagnose P2P connectivity | [Browser-assisted check](../src/apps/webpeer/README.md#p2p-connection-check), [network tips](tips/p2p-sync-tips.md), and [self-hosted TURN](../docker/coturn/README.md) |
| Understand a setting or command | [Settings reference](settings.md) |
| Read or customise synchronisation status | [Status indicators and CSS snippets](tips/status-display.md) |
| Investigate or recover from a problem | [Troubleshooting](troubleshooting.md), then the relevant [recovery procedure](recovery.md) |
| Prepare an issue report | [Issue reporting](to_issue_reporting.md) |

The project overview links to Japanese and Chinese documentation.

## Implementation and technical references

Use these references for the area being changed, together with its relevant ADR. Check the document's stated scope and validation limits before relying on a guarantee.

| Area | References |
|---|---|
| Overall synchronisation and terminology | [Technical overview](tech_info.md), [glossary](glossary.md), and [terminology conventions](terms.md) |
| Metadata, Chunks, and database representations | [Data structures](datastructure.md) |
| Conflict resolution, provenance, and history restoration | [Conflict and provenance contract](specs_conflict_resolution.md), [Document History restoration](design_docs/document_history_revision_restoration.md), and [local save completion](adr/2026_10_local_file_save_completion_and_batching.md) |
| Replicator and host boundaries | [Replicator architecture snapshot](design_docs/replicator_architecture.md) and [service feature and legacy Module boundaries](design_docs/service_feature_and_legacy_module_boundaries.md) |
| Chunk retrieval and maintenance | [Chunk retrieval and waiting](design_docs/chunk_retrieval_and_waiting.md), [Garbage Collection V3](specs_garbage_collection.md), and [Data Compression](specs_data_compression.md) |
| Document identity and validation | [Unicode path identity](design_docs/unicode_path_identity.md), [configurable ID derivation](design_docs/configurable_id_derivation.md), [Metadata ID validation and repair](design_docs/metadata_document_id_validation_and_repair.md), and [path component compatibility](design_docs/path_component_length_compatibility.md) |
| Settings compatibility and profiles | [Tweak compatibility and recovery](design_docs/tweak_compatibility.md) and [remote configuration management](design_docs_of_remote_configurations.md) |
| Encryption and sharing | [Metadata encryption](design_docs/internal_metadata_encryption.md) and [time-bound Setup URIs](design_docs/time_bound_setup_uri.md) |
| P2P connection preparation | [TURN connection settings](design_docs/renewable_turn_credentials.md) |
| Journal storage internals | [Journal Replicator 2nd Edition](design_docs_of_journalsync_2nd.md) |

The installed `@vrtmrz/livesync-commonlib` package is authoritative for shared runtime contracts. Use the exact dependency selected by [package.json](../package.json) and its lockfile when checking behaviour. The [Commonlib documentation](https://github.com/vrtmrz/livesync-commonlib/tree/main/docs) is maintained in that repository; this index does not replace its package contracts.

## Architectural decisions

Read the decisions relevant to the change, rather than treating the whole ADR directory as a prerequisite. A decision's acceptance, its implementation, its release, and its remaining verification work are separate facts.

| Decision area | Records |
|---|---|
| Shared package boundary | [Common library package boundary](adr/2026_07_common_library_package_boundary.md) |
| Replicator capabilities and migration | [Core contract](adr/2026_08_replicator_capabilities_01_core_contract.md), [P2P service lifecycle](adr/2026_08_replicator_capabilities_02_p2p_service_lifecycle.md), and [migration plan](adr/2026_08_replicator_capabilities_03_migration_plan.md) |
| Remote resources and Fast Setup | [CouchDB connection ownership](adr/2026_08_couchdb_remote_connection_ownership.md), [Fast Fetch eligibility](adr/2026_08_fast_fetch_transport_eligibility.md), and [persistence and completion](adr/2026_08_fast_fetch_persistence_and_completion.md) |
| P2P lifecycle and setup | [Transport lifecycle](adr/2026_07_p2p_transport_lifecycle.md), [connection check](adr/2026_07_p2p_connection_check.md), [profile-aware onboarding](adr/2026_07_multiple_remote_onboarding.md), and [compatibility controls](adr/2026_08_p2p_transport_compatibility.md) |
| Settings interface integration | [Declarative settings adapter](adr/2026_08_declarative_settings_adapter.md) |
| Saving and path identity | [Local file save completion and batching](adr/2026_10_local_file_save_completion_and_batching.md) and [Unicode path identity](adr/2026_10_unicode_path_identity.md) |
| Activity and Chunk arrival | [Bounded remote activity](adr/2026_07_bounded_remote_activity.md) and [Chunk arrival quiescence](adr/2026_07_chunk_arrival_quiescence.md) |
| Compatibility and validation | [Release notes and database compatibility gates](adr/2026_07_release_notes_and_database_compatibility.md) and [real Obsidian E2E](adr/2026_06_real_obsidian_e2e.md) |

## Proposals and incomplete explanations

These records are useful for design work. Their proposed representation or behaviour is not a current runtime contract.

| Document | Recorded state |
|---|---|
| [Tiered Chunk Storage with Live Compaction](design_docs/tired_chunk_pack.md) | In design |
| [Tiered Chunk Storage for Bucket Sync](design_docs/tired_chunk_pack_bucket.md) | In design |
| [Design intent for Metadata and Chunks](design_docs/intention_of_chunks.md) | Incomplete explanation; use the data-structure reference for current representations |
| [Feature maturity for 1.0](adr/2026_07_feature_maturity_for_1_0.md) | Proposed; publication of 1.0 alone does not establish formal acceptance of this record |

## Historical and retired designs

These documents preserve earlier motivations, approaches, or results. Follow their maintained replacement for current operations.

| Historical material | Current starting point |
|---|---|
| [Original Tweak-sharing proposal](design_docs_of_sharing_tweak_value.md) | [Tweak compatibility and recovery](design_docs/tweak_compatibility.md) |
| [First Journal Sync design](design_docs_of_journalsync.md) | [Journal Replicator 2nd Edition](design_docs_of_journalsync_2nd.md) |
| [Eden design and operational results](design_docs_of_keep_newborn_chunks.md#results-from-actual-operation) | The document records its deprecated, frozen status; use [Data structures](datastructure.md) for representations still accepted by current code |
| [Withdrawn Chunk Aggregation by Prefix](design_docs/chunk_aggregation_by_prefix.md) | Retained as a withdrawn proposal, not an implemented storage layout |

Dated measurements, including the [Data Compression benchmark](specs_data_compression.md#reproducible-benchmark), remain evidence for their recorded revision and environment. A current rerun is a separate measurement.

## Development, validation, and release history

- [Development guide](../devs.md): build, module ownership, and release workflow.
- [Contributing](../CONTRIBUTING.md): contribution and documentation checks.
- Independent applications: [CLI](../src/apps/cli/README.md), [WebApp](../src/apps/webapp/README.md), and [WebPeer](../src/apps/webpeer/README.md).
- [Setup utilities](../utils/readme.md): provisioning and Setup URI generation.
- [Review Harness](review_harness.md): bounded real-device observations and performance measurements.
- [Test procedures](../test/README.md): choose the suite which owns the boundary being changed.
- [Change notes](../updates.md): current release and unreleased changes.
- Published release archives: [1.0](releases/1.0.md), [1.0 previews](releases/1.0-previews.md), [0.25](releases/0.25.md), and [earlier releases](releases/legacy.md).

When a feature ships or a design is replaced, update its implementation note and this index if its role changes. Preserve the original decision and measurement history, state the maintained replacement, and keep existing links working.
