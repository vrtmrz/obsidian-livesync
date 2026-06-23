# The design document of remote configuration management

## Goal

- Allow us to manage multiple remote connections in a single vault.
- Keep the existing synchronisation implementations working without requiring a large rewrite.
- Provide a safe migration path from the previous single-remote configuration model.
- Allow connections to be imported and exported in a compact and reusable format.

## Motivation

Historically, Self-hosted LiveSync stored one effective remote configuration directly in the main settings. This was simple, but it had several limitations.

- We could only keep one CouchDB, one bucket, or one Peer-to-Peer target as the effective configuration at a time.
- Switching between same-type-remotes required manually rewriting the active settings.
- Setup URI, QR code, CLI setup, and similar entry points all restored settings differently, which made migration logic easy to miss.
- The internal settings shape had gradually become a mix of user-facing settings, transport-specific credentials, and compatibility-oriented values.

Once multiple remotes of the same type became desirable, the previous model no longer scaled well enough. We therefore needed a structure that could store many remotes, still expose one effective remote to the replication logic, and keep migration and import behaviour consistent.

## Prerequisite

- Existing synchronisation features must continue to read an effective remote configuration from the current settings.
- Existing vaults must continue to work without requiring manual reconfiguration.
- Setup URI, QR code, CLI setup, protocol handlers, and other imported settings must be normalised in the same way.
- Import and export must be compact enough to be shared easily.
- We must be explicit that exported connection strings may contain credentials or secrets.

## Outlined methods and implementation plans

### Abstract

The current settings now have two layers for remote configuration.

1. A stored collection of named remotes.
2. One active remote projected into the legacy flat settings fields.

This means the replication and database layers can continue to read the effective remote from the existing settings fields, while the settings dialogue and migration logic can manage many stored remotes.

In short, the list is the source of truth for saved remotes, and the legacy fields remain the runtime compatibility layer.

### Data model

The main settings now contain the following properties.

```typescript
type RemoteConfiguration = {
    id: string;
    name: string;
    uri: string;
    isEncrypted: boolean;
};

type RemoteConfigurations = {
    remoteConfigurations: Record<string, RemoteConfiguration>;
    activeConfigurationId: string;
};
```

Each entry stores a connection string in `uri`.

- `sls+http://` or `sls+https://` for CouchDB-compatible remotes
- `sls+s3://` for bucket-style remotes
- `sls+p2p://` for Peer-to-Peer remotes

This structure allows multiple remotes of the same type to be stored without adding a large number of duplicated settings fields.

### Runtime compatibility

The replication logic still reads the effective remote from legacy flat settings such as the following.

- `remoteType`
- `couchDB_URI`, `couchDB_USER`, `couchDB_PASSWORD`, `couchDB_DBNAME`
- `endpoint`, `bucket`, `accessKey`, `secretKey`, and related bucket fields
- `P2P_roomID`, `P2P_passphrase`, and related Peer-to-Peer fields

When a remote is activated, its connection string is parsed and projected into these legacy fields. Therefore, existing services do not need to know whether the remote came from an old vault, a Setup URI, or the new remote list.

This projection is intentionally one-way at runtime. The stored remote list is the persistent catalogue, while the flat fields describe the remote currently in use.

### Connection string format

The connection string is the transport-neutral storage format for a remote entry.

Benefits:

- It is compact enough for clipboard-based workflows.
- It can be used for import and export in the settings dialogue.
- It avoids introducing a separate serialisation format only for the remote list.
- It can be parsed into the legacy settings shape whenever the active remote changes.

This is not equivalent to Setup URI.

- Setup URI represents a broader settings transfer workflow.
- A remote connection string represents one remote only.

### Import and export

The settings dialogue now supports the following workflows.

- Add connection: create a new remote by using the remote setup dialogues.
- Import connection: paste a connection string, validate it, and save it as a named remote.
- Export: copy a stored remote connection string to the clipboard.

Import normalises the string by parsing and serialising it again before saving. This ensures that equivalent but differently formatted URIs are saved in a canonical form.

Export is intentionally simple. It copies the connection string itself, because this is the most direct representation of one remote entry.

### Security note

Connection strings may include credentials, secrets, JWT-related values, or Peer-to-Peer passphrases.

Therefore:

- Export is a deliberate clipboard operation.
- Import trusts the supplied connection string as-is after parsing.
- We should regard exported connection strings as sensitive information, much like Setup URI or a credentials-bearing configuration file.

The `isEncrypted` field is currently reserved for future expansion. At present, the connection string itself is stored plainly inside the settings data, in the same sense that the effective runtime configuration can contain usable remote credentials.

### Migration strategy

Older vaults store only one effective remote in the flat settings fields. The migration creates a first remote list from those values.

Rules:

- If no remote list exists and the legacy fields contain a CouchDB configuration, create `legacy-couchdb`.
- If no remote list exists and the legacy fields contain a bucket configuration, create `legacy-s3`.
- If no remote list exists and the legacy fields contain a Peer-to-Peer configuration, create `legacy-p2p`.
- If more than one legacy remote is populated, create all possible entries and select the active one according to `remoteType`.

This migration is intentionally additive. It does not remove the flat fields because they remain necessary as the active runtime projection.

### Normalisation and application paths

One important design lesson from this work is that migration cannot rely only on loading `data.json`.

Settings may enter the system from several routes:

- normal settings load
- Setup URI
- QR code
- protocol handler
- CLI setup
- Peer-to-Peer remote configuration retrieval
- red flag based remote adjustment
- settings markdown import

To keep behaviour consistent, normalisation is centralised in the settings service.

- `adjustSettings` is responsible for in-place normalisation and migration of a settings object.
- `applyExternalSettings` is responsible for applying imported or externally supplied settings after passing them through the same normalisation flow.

This ensures that imported settings can migrate to the current remote list model even if they never passed through the ordinary `loadSettings` path.

### Why not store only the remote list

It would be possible to let all consumers parse the active remote every time and stop using the flat fields entirely. However, this would require broader changes across replication, diagnostics, and compatibility layers.

The current design keeps the change set limited.

- The remote list improves storage and UX.
- The flat fields preserve compatibility and reduce migration risk.

This is a pragmatic transitional architecture, not an accidental duplication.

## Test strategy

The feature should be tested from four viewpoints.

1. Migration from old settings.
   - A vault with only legacy flat remote settings should gain a remote list automatically.
   - The correct active remote should be selected according to `remoteType`.

2. Runtime activation.
   - Activating a stored remote should correctly project its values into the effective flat settings.

3. External import paths.
   - Setup URI, QR code, CLI setup, Peer-to-Peer remote config, red flag adjustment, and settings markdown import should all pass through the same normalisation path.

4. Import and export.
   - Imported connection strings should be parsed, canonicalised, named, and stored correctly.
   - Export should copy the exact saved connection string.

## Documentation strategy

- This document explains the design and compatibility model of remote configuration management.
- User-facing setup documents should explain only how to add, import, export, and activate remotes.
- Release notes may refer to this document when changes in remote handling are significant.

## Outlook

Import/export configuration strings should also be encrypted in the future, but this is a separate feature that can be added on top of the current design.

## Consideration and conclusion

The remote configuration list solves the practical need to manage multiple remotes without forcing the whole codebase to abandon the previous effective-settings model at once.

Its core idea is modest but effective.

- Store named remotes as connection strings.
- Select one active remote.
- Project it into the legacy settings for runtime use.
- Normalise every imported settings object through the same path.

This keeps the implementation understandable and migration-friendly. It also opens the door for future work, such as encrypted per-remote storage, richer remote metadata, or remote-scoped options, without forcing another large redesign of how remotes are represented.