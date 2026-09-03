---
date: 2026-09-03
commonlib-version: "0.1.21"
self-hosted-livesync-version: "1.0.24"
status: accepted
---

# Project glossary

This glossary records stable, project-specific meanings used by Self-hosted
LiveSync. Ordinary English and established technology terms retain their usual
meanings unless they are defined here. Exact code identifiers, API names, and
user-interface labels retain their source spelling.

The sections describe the intended audience, not a visibility guarantee. A
term in the developer and design section can appear in code, tests, logs, or
diagnostics. That does not make it user-interface vocabulary or a public
extension contract.

## User-facing and operational terms

These terms can appear in the user interface, user documentation, setup and
recovery guidance, or diagnostics intended for users.

### A–R

- **Boot-up sequence (boot sequence):** The initialisation process of the
  plug-in when Obsidian starts. It begins with loading the plug-in, setting up
  core services, loading saved settings, and opening the local database. After
  the layout is ready, the plug-in checks for flag files, runs configuration
  diagnostics, connects to the remote database, and begins file watching. The
  sequence finishes when the plug-in is ready and operational.
- **Broken files (size mismatch):** A state where a file's Metadata and the
  content stored in its Chunks do not match, causing file retrieval or
  synchronisation failures. Inspect these mismatches with **Inspect conflicts
  and file/database differences** in the Hatch pane, then handle one exact
  revision at a time.
- **Chunk / Chunks:** Divided units of data stored in the database or Object
  Storage to support efficient synchronisation.
- **Compaction:** A database maintenance procedure which discards old
  historical document revisions to reduce remote database size.
- **Continuous replication:** A provider's long-running replication mode. It
  remains active to exchange changes until stopped and is distinct from a
  finite OneShot Sync operation.
- **Custom HTTP Handler / Use Internal API (CORS bypass settings):** Settings
  which bypass CORS restrictions by routing requests through Obsidian's native
  request APIs. There are separate settings for each central remote type:
  - **S3-compatible Object Storage (`useCustomRequestHandler`):** Labelled
    **Use Custom HTTP Handler** in the standard settings tab and **Use internal
    API** in the Svelte Setup Wizard dialogue. It is represented as `useProxy`
    in Setup URI query parameters for compatibility.
  - **CouchDB (`useRequestAPI`):** Labelled **Use Request API to avoid
    inevitable CORS problem** in the standard settings tab and **Use Internal
    API** in the Svelte Setup Wizard dialogue. It is represented as
    `useRequestAPI` in Setup URI query parameters.
- **Customisation Sync:** The feature which synchronises settings, snippets,
  themes, and plug-ins. Write 'Customisation' with an 's' in documentation;
  technical configuration and links can use `customization` where required.
- **Database Adapter (IDB and IndexedDB):** The local database storage
  interface used by PouchDB. The `IDB` adapter is recommended because the older
  `IndexedDB` adapter is obsolete and can cause memory leaks in LiveSync mode.
  Switching adapters requires local data migration and an Obsidian restart,
  but not a full database rebuild.
- **Database Suffix (`additionalSuffixOfDatabaseName`):** A suffix appended to
  the database name so that multiple Vaults with the same name can synchronise
  to the same remote server.
- **E2EE Algorithm:** The cryptographic algorithm version used for end-to-end
  encryption. All synchronising devices must use a compatible version, such as
  `V2` or `V1`.
- **Eden (Eden Chunks):** A sunset-compatibility optimisation in which newly
  created Chunks are held inside the document until they stabilise, before
  becoming independent Chunks.
- **Fast Setup (Simple Fetch):** The preferred automated initial
  synchronisation flow for a secondary device. It uses Streaming replication
  for the initial download and delays local file reflection to avoid temporary
  synchronisation warnings.
- **Fast Fetch:** The CouchDB-specific Streaming replication path used by Fast
  Setup. It reads the changes feed in bounded pages and persists a checkpoint
  so an interrupted transfer can resume. An ineligible transport uses the
  ordinary fetch path instead.
- **Flag files (`redflag.md`, `redflag2.md`, and `redflag3.md`):** Special
  Markdown files or directories at the Vault root which stop the boot-up
  sequence or trigger recovery work. `redflag.md` suspends all processes,
  `redflag2.md` (`flag_rebuild.md`) triggers a full database rebuild, and
  `redflag3.md` (`flag_fetch.md`) discards and fetches the local database again.
- **Garbage Collection (GC):** The maintenance process which identifies Chunk
  documents not reachable from a current file or conflict branch, records
  logical deletions for them, propagates those deletions, and requests remote
  compaction to reclaim storage.
- **Hatch (Hatch pane):** The troubleshooting and maintenance section in the
  plug-in settings. It contains diagnostics, database reset controls, status
  reports, and advanced edge-case settings.
- **Hidden File Sync:** The feature which synchronises files in hidden
  directories, such as `.obsidian`.
- **JWT Authentication:** An experimental CouchDB authentication option which
  uses a JSON Web Token instead of standard credentials. It requires a private
  key or secret, algorithm, expiry duration, subject, and key ID.
- **LiveSync:** This name has two established meanings: the shortened plug-in
  name for Self-hosted LiveSync, and the Sync Mode for continuous, real-time
  synchronisation. Prefer 'Continuous replication' in design documentation
  when the mode, rather than the product, is meant.
- **livesync-serverpeer / WebPeer:** Specialised clients which assist WebRTC
  peer-to-peer communication.
- **Metadata (file metadata):** A database document which stores file
  properties, including its name, path, size, modification time, and references
  to the Chunks containing its content. PouchDB or CouchDB revision metadata
  carries conflict state; the file Metadata document has no separate history
  field. Metadata and file content are stored separately.
- **OneShot Sync (OneShot replication):** One finite bidirectional
  synchronisation operation, normally pull then push, which is requested
  directly or by an event. It is distinct from Continuous replication.
- **Overwrite Server Data with This Device's Files:** A maintenance operation,
  formerly named `Rebuild everything`, which discards the remote database and
  rebuilds the local and remote databases from the current files on one
  authoritative device.
- **Path Obfuscation:** A privacy option which encrypts file paths and folder
  names on the remote server.
- **plug-in:** The spelling used in user-facing messages and general prose.
  Retain `plugin` in code, configuration, and established technical names.
- **Remediation (`maxMTimeForReflectEvents`):** A recovery setting which limits
  reflection of changes from the database to the Vault by ignoring file events
  after a specified date and time.
- **Reset Synchronisation on This Device:** A maintenance operation, formerly
  named `Fetch everything`, which discards the local database and rebuilds it
  from the remote database.

### Revision

A revision is a version of one PouchDB or CouchDB document. Concurrent changes
can form a revision tree with more than one current branch.

Revision modifiers describe independent properties. More than one can apply to
the same revision:

- **leaf:** Has no known child revision.
- **winner:** Is the leaf selected by PouchDB or CouchDB as the current
  document.
- **conflict:** Is another current leaf which was not selected as the winner.
- **Vault-matching:** Represents the same file content, or the same absent-file
  state, as the current Vault. More than one revision can match.
- **displayed:** Is recorded by valid device-local file provenance as the
  branch represented in the Vault. A pending local edit might no longer match
  its bytes, but still extends this recorded branch.
- **logically deleted:** Represents absence of the file through a deletion
  marker. A logically deleted revision can also be a leaf, winner, conflict,
  or Vault-matching revision. An absent file retains no displayed provenance.

Avoid 'live revision' because it can mean either a current leaf or a
non-deleted revision. See
[Independent revision properties](specs_conflict_resolution.md#independent-revision-properties)
for the relationship between revision-tree roles, Vault state, and
device-local provenance.

### S–Z

- **Scram (Scram Switches):** Emergency controls which suspend file watching or
  database reflection to reduce the risk of corruption or unintended changes.
- **Security Seed:** The remote PBKDF2 salt used to derive the encryption key
  for replication. It must be read from, or established on, the remote before
  encrypted synchronisation.
- **Segmenter (Segmented-splitter):** A chunking method which divides files at
  semantic boundaries, such as paragraphs or sections, rather than arbitrary
  byte boundaries.
- **Self-hosted LiveSync:** The name of this plug-in. 'Self-hosted' is one
  hyphenated word.
- **Setting Doctor (Config Doctor):** A diagnostic utility which identifies
  configuration mismatches or suboptimal settings and presents recommended
  values and reasons.
- **Setup URI:** An encrypted representation of plug-in settings and remote
  configuration which can be transferred to another device and opened with a
  passphrase.
- **Signalling relay (P2P):** A Nostr-compatible WebSocket relay used for peer
  discovery and WebRTC connection negotiation. It does not store or transfer
  Vault content. The project author operates a public relay as a best-effort
  convenience, and users can supply another compatible relay.
- **Streaming replication (stream-based replication):** A transfer method
  which downloads database documents as a continuous stream of events. Fast
  Setup uses it to retrieve remote Metadata efficiently.
- **Sync Mode:** The trigger mechanism for synchronisation. Current modes are
  **LiveSync**, for continuous replication, **Periodic Sync**, for work at a
  configured interval, and **On Events**, for configured application events.
- **Synchronising devices:** Devices which participate in the same
  synchronisation for a Vault. The term describes membership rather than
  current activity, so it includes offline and idle devices.
- **TURN Server (WebRTC P2P):** A Traversal Using Relays around NAT server used
  as an optional fallback when NAT or firewall rules prevent a direct WebRTC
  connection. It relays encrypted WebRTC traffic and is distinct from the
  signalling relay.
- **Update Thinning (Batch database update):** An optimisation which groups
  local file edits over a short delay before committing them to the local
  database, reducing database writes.
- **WebRTC P2P (peer-to-peer):** A synchronisation method which allows devices
  to communicate directly without a central remote database.

## Developer and design terms

These definitions are stable vocabulary for architecture documents, ADRs,
implementation, tests, and code review. They might never appear in the user
interface. Inclusion here fixes their project meaning; it does not make the
named surface a public API or extension point.

### Active publication

The atomic publication of one Replicator provider, its `ReplicatorInstance`,
and its configuration identity, owned by Commonlib's `ReplicatorService`. Its
object identity is the admission fence for operations. An active publication
is also called the active Replicator publication, and its instance is the
**active Replicator**. 'Active publication' is more precise than 'current
Replicator' when admission or retirement matters.

### Adjunct P2P transport

P2P operating as an additional transport while CouchDB or Object Storage is
the selected main remote. It retains its own service and room-session
ownership; it is not the active Replicator for the main remote. Architecture
documents can shorten this to 'adjunct P2P' where the distinction is already
clear.

### Admission and reservation

**Admission** is permission for an operation to use one exact active
publication or P2P room session. A **reservation** records admitted work and
keeps its owner alive until that work settles. Retirement closes admission
before it waits for existing reservations, so later work cannot enter the
retiring generation.

### Bounded remote activity

A finite logical operation which can involve remote work, waiting, queueing, or
local result handling. Its lifetime is broader than an individual network
request. Continuous replication is not bounded remote activity. See the
[Bounded Remote Activity ADR](adr/2026_07_bounded_remote_activity.md).

### Capability

A typed declaration that a Replicator provider supports an operation or remote
resource, does not implement it, or considers it inapplicable. Capability
support is explicit; callers do not infer it from a legacy method, a Boolean
default, or a neutral return value.

### Central remote

A CouchDB or Object Storage remote which can require central preparation and
administration before replication. P2P is not a central remote. The **main
remote** is the `RemoteType` selected for the active Replicator; P2P can also
operate as an additional transport when a central remote is selected.

### Configuration identity

An opaque projection of the effective settings which determine whether an
existing provider instance or P2P binding can be retained. It can contain
credentials. Code can compare an identity for equality, but must not inspect,
log, persist, or display it.

### Fence, generation, and epoch

A **fence** prevents stale work or work admitted by one owner from affecting a
replacement owner or state. A **generation** normally changes when one local
lifecycle is invalidated. An **epoch** identifies one session or data history
where the owning contract uses that term. These values belong to distinct state
machines and are not interchangeable or evidence that another owner is
current.

### Focused view

A narrow interface exposing only the operations required by a consumer. It
delegates to a stable owner and does not independently own the underlying
mutable state or resource.

### Interaction authority

The explicit upper bound on user interaction permitted during an operation.
User-initiated work can receive selected permissions; unattended work carries
`NO_INTERACTION` and cannot open a dialogue, request peer selection, or obtain
authority through a fallback path.

### Journal remote epoch

The `protocolVersion:pbkdf2salt` value stored as
`CheckPointInfo.journalEpoch`. It identifies Journal checkpoint and
deduplication-cache history. It is data-history state, not a cancellation,
Replicator retirement, or operation-admission fence.

### Non-owning adapter

An adapter which implements a contract by delegating to another component
without owning the delegated resource. Closing it releases only resources
which the adapter itself owns. In particular, closing the active P2P adapter
does not close the stable P2P service or its room session.

### Owner and ownership

The **owner** is the single component responsible for creating, replacing,
stopping, and disposing a resource or stateful lifecycle. A borrower, adapter,
or focused view can use that resource only within its declared boundary and
must not perform the owner's lifecycle operations.

### P2P service, room session, and demand

The **P2P service** is the stable Commonlib owner which supplies focused views
and owns replaceable room sessions. A **P2P room session** is one active room
membership and the resources whose validity depends on it. **Demand** is one
persistent or finite reason for the owner to retain a room. Releasing one
demand does not close a room retained by another. A room's effective binding
includes the settings, local database object, and device identity which make
that session valid. A **session epoch** is the internal identity and fence of
one room-session object, not a persisted room name or a public numeric counter.
An **automation baseline** records peers for which the initial transfer
completed in the current logical automation lifecycle; it is owned
independently of a replaceable room session. A **configured target** is a
persisted peer name selected for unattended `P2P_SyncOnReplication`; the
request can wait for its advertisement, but cannot prompt for peer selection.

### Publication retirement

The lifecycle transition which removes an active publication from current
admission, asks its provider to stop transfer work, drains reservations for
that exact publication, closes the old instance, and marks retirement
complete. **Quiescing** is the state after admission has closed and before
retirement completes. A replacement cannot be published across an incomplete
retirement fence. A **candidate** is a newly constructed instance which remains
private until initialisation and freshness checks permit atomic publication.

### Remote resource and probe

A **remote resource** is a provider-declared, caller-owned object created from
one effective-settings snapshot for a bounded task. A **probe** is a bounded,
flow-specific validation or observation for connection, compatibility, setup,
or diagnostics. It can use an owned remote resource or an owner-arbitrated P2P
trial. It does not publish or replace the active Replicator, and the caller
disposes every resource which it owns.

### Replicator

The project abstraction which performs replication for one configured remote
kind and implements the `ReplicatorInstance` lifecycle contract. Use
'replication' for the process and 'Replicator' for this runtime abstraction. A
Replicator can be an owning transport implementation or a non-owning adapter;
the provider contract determines the boundary.

### Replicator provider definition

The exhaustive, host-composed declaration for one `RemoteType`: its
configuration identity, Replicator factory, readiness requirement,
capabilities, remote-resource factories, operation runners, and optional
central administration. The readiness requirement declares which layer must
establish operation preconditions. The provider catalogue is **closed
composition**, not a runtime registry: adding a provider requires changing,
shipping, and testing the owning composition. A **built-in provider** is one
included in that shipped catalogue. Architecture prose can shorten 'Replicator
provider definition' to 'provider'; it does not mean only the transport
instance.

### Replication outcome

The typed settlement of an attempted replication operation, represented by
`ReplicationOutcome`. Completed, partial, blocked, cancelled, and failed states
remain explicit; `undefined`, an empty value, or a compatibility default is not
treated as successful work.

### Service composition terms

- A **Service Hub** is the long-lived registry of service contracts for one
  application composition.
- A **Service** owns a stable shared capability and its lifecycle.
- A **ServiceModule** is a host-created, long-lived stateful or resource-owning
  capability shared through the typed `ServiceModules` record.
- A **serviceFeature** is a typed composition function which accepts declared
  Services and ServiceModules, registers host integration, and can return a
  focused view. It is not a runtime registry entry.
- A **legacy Module** is an existing application structure retained for
  compatibility. New behaviour does not acquire the complete core merely to
  imitate that locator pattern.

See [Service feature and legacy Module boundaries](design_docs/service_feature_and_legacy_module_boundaries.md)
for the selection and composition rules.

### Suspension

A reversible lifecycle action which stops active transfer work without
retiring the active Replicator publication. The P2P service also closes its
current room session during application suspension because that session has a
separate owner and lifecycle. Resumption can retain the Replicator instance and
open a new P2P room as required.
