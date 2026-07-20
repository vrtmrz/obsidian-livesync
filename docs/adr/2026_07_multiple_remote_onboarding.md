# Architectural Decision Record: Make Onboarding Profile-Aware

## Status

Accepted — implemented and verified against the locked Commonlib package.

## Context

Self-hosted LiveSync stores multiple remote connections in `remoteConfigurations` and selects the ordinary replication target with `activeConfigurationId`. P2P features have a separate `P2P_ActiveRemoteConfigurationId`. Existing replication implementations still consume the older flat CouchDB, Object Storage, and P2P fields, so selecting a profile projects its connection settings onto those compatibility fields.

The settings pane already creates and edits profiles directly. The Setup Wizard was inconsistent:

- modern Setup URI and QR payloads retained a supplied profile map;
- legacy imports relied on `SettingService` to migrate flat connection fields into `legacy-*` profiles;
- manual CouchDB and Object Storage setup wrote only the flat fields and relied on that same migration; and
- manual P2P setup partly updated the profile map itself.

Legacy migration deliberately runs only when the profile map is empty. If a Vault already had one or more profiles, manually configuring another CouchDB or Object Storage connection changed the flat fields but did not add a profile. The selected stored profile could subsequently project its older values back onto those fields. Fresh P2P onboarding could also finish without a profile when no P2P profile ID existed beforehand.

## Decision

The profile map is authoritative persisted state for every newly configured remote. The compatibility fields remain the runtime projection of a selected profile and the input accepted from an older settings payload.

### Manual onboarding

A successful manual CouchDB, Object Storage, or P2P setup creates or deliberately updates a profile through Commonlib's focused `@vrtmrz/livesync-commonlib/remote-configurations` entry.

- Existing profiles are preserved.
- A newly created profile receives an opaque generated ID.
- CouchDB and Object Storage setup select the new profile as the main remote.
- P2P setup selects the profile through `P2P_ActiveRemoteConfigurationId`.
- P2P setup also selects it as the main remote when P2P is being configured as the main remote.
- Configuring P2P alongside another main remote changes only the P2P selection.
- A known profile ID is supplied only when an existing profile is deliberately being updated; omitting the ID creates another profile.

The onboarding dialogue does not add a naming step. Commonlib proposes a concise type-specific display name and adds a numeric suffix when necessary. The settings pane can rename it later.

### Identity and naming

Profile names are presentation only. They are neither unique identity nor a marker for the selected profile. No entry receives a special `default` ID or name. Opaque IDs establish identity, `activeConfigurationId` establishes the main selection, and `P2P_ActiveRemoteConfigurationId` establishes the P2P selection.

Generated names describe the connection without exposing credentials, for example `CouchDB couch.example`, `S3 notes`, or `P2P team-room`.

### Setup URI and QR import

A modern payload preserves its profile IDs, display names, profile URIs, main selection, and P2P selection. Setup does not rename or recreate those profiles.

A legacy payload containing only flat connection fields remains supported. `SettingService` migrates it into clearly labelled `legacy-couchdb`, `legacy-s3`, or `legacy-p2p` profiles only when no modern profile map exists. This is the only onboarding path which intentionally relies on the compatibility migration.

### Persistence and restart ordering

Profile construction happens before the settings are submitted to the onboarding completion boundary. Existing-device and new-device setup reserve Fetch or Rebuild respectively before enabling and saving the settings. Profile awareness does not change that initialisation ownership or restart ordering.

Commonlib produces an in-memory plaintext profile URI. The standard setting service applies its configured at-rest encryption during persistence.

## Alternatives rejected

### Keep relying on legacy migration

This works only while the profile map is empty. It silently fails to register a newly configured connection once multiple-remote settings are already in use and leaves P2P with a separate implementation.

### Create a special `default` profile

The special meaning would duplicate `activeConfigurationId`, make a user-visible name carry identity, and become ambiguous as soon as the user selects another profile. Selection IDs already express the required state.

### Add profile naming and full list editing to onboarding

That would make the first-run path longer and duplicate the established Remote Databases interface. Automatic descriptive names and later renaming keep this change limited to data integrity and consistent selection.

### Replace the compatibility fields immediately

Replication, diagnostics, and older settings paths still consume the projected fields. Removing them belongs to a broader runtime migration and is not required to make onboarding correctly profile-aware.

## Verification

Commonlib unit tests cover preserving existing profiles, opaque-ID insertion, generated display names, duplicate-name suffixes, main activation, independent P2P selection, and URI serialisation. Its packed-consumer test imports the focused entry point from the generated package.

Self-hosted LiveSync unit tests cover preserving modern Setup URI profiles and their active selection, retaining legacy Setup URI and QR migration, adding CouchDB and Object Storage profiles beside an existing profile, independent P2P selection, fresh P2P selection as both main and P2P remote, and cancellation without mutation.

The real-Obsidian onboarding E2E owns the invitation, dialogue presentation, safe-area and touch-target checks, cancellation, and command reopening. It does not contact a remote or submit credentials. Remote connection correctness remains owned by the CouchDB, Object Storage, P2P, and two-Vault suites. The end-to-end Setup URI and provisioning acceptance workflow remains a separate release gate.

## Consequences

- Manual onboarding and the Remote Databases pane share one Commonlib profile contract.
- Existing profiles survive reconfiguration, and a newly configured connection becomes explicitly selectable.
- Modern imports retain user-assigned profile identity and names.
- Legacy Setup URIs continue to work through an isolated compatibility boundary.
- Runtime consumers may keep using projected flat fields while the persisted model and new APIs use the 1.0 multiple-remote contract.
