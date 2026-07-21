# Release notes and database compatibility gates

## Status

Accepted for the 1.0 release line.

## Context

Self-hosted LiveSync historically used several unrelated kinds of version and settings state during start-up.

The plug-in SemVer was converted into a numeric major/minor value and stored in `lastReadUpdates`. The settings dialogue used that value to open the change log automatically, and offered a button which marked the release line as read. Patch versions were intentionally ignored. Pre-release identifiers containing an additional dot did not fit this numeric representation and could be interpreted as a much larger release line.

Separately, the internal database compatibility constant `VER` is recorded in device-local storage under a Vault-scoped key. Crossing this internal version used to set `versionUpFlash` and permanently change several automatic synchronisation settings to `false`. Replication services already reject work while `versionUpFlash` is non-empty, so changing the user's saved choices duplicated the runtime safety gate and required manual reconstruction after acknowledgement.

The remote `obsydian_livesync_version` document also carries the internal database version. It is a protocol and data-compatibility mechanism, not a copy of the plug-in SemVer.

Commonlib's `settingVersion` describes the stored settings shape, while `DEFAULT_SETTINGS` was historically used both to complete missing values in an existing document and to initialise a new Vault. Those operations require different defaults: an existing Vault needs conservative completion, while a genuinely new Vault can use current recommendations without changing an established configuration.

## Decision

### Release notes

- Keep the change-log pane and render the current release history whenever it is opened.
- Remove automatic unread-version tracking, the acknowledgement button for ordinary release notes, and automatic navigation to the change-log pane.
- Do not derive data-compatibility behaviour from the plug-in's major, minor, patch, or pre-release identifiers.
- Retain the saved `lastReadUpdates` field in the settings schema for backwards compatibility, but do not use it in the plug-in. It can be removed through a separately reviewed settings-schema migration if retaining it later becomes burdensome.

### Settings schema and initial settings

- Keep the Commonlib settings schema version independent of the plug-in SemVer and the internal database version `VER`. Increment it only for an ordered change to the stored settings shape.
- Use Commonlib's conservative schema defaults to complete an existing settings document. Explicit stored values take precedence, and an ordinary migration does not disable or replace the person's synchronisation choices.
- Use `createNewVaultSettings()` only for a store which has never held Self-hosted LiveSync settings, explicit new-user onboarding, a factory reset, or CLI settings creation. Setup URI, QR, Markdown, and other existing-setting imports retain conservative completion semantics.
- Apply remote-specific preferred values only when that remote is explicitly selected during setup. Do not infer and merge new recommendations into an existing configuration.
- Keep settings saved by a future Commonlib schema fail-closed and do not persist an apparent downgrade migration.

The current new-Vault base selects a 50 MB maximum synchronised file size, Rabin–Karp chunk splitting, Plug-in Sync V2, case-insensitive file-name handling, and E2EE V2. It does not enable synchronisation, encryption, or a remote connection without user action. Chunk revisions are always content-derived; `doNotUseFixedRevisionForChunks` remains only as deprecated compatibility input and is not a recommendation or review setting.

An existing settings document without an explicit `handleFilenameCaseSensitive` choice keeps that value unresolved and enters compatibility review. The running host can explicitly retain legacy case-sensitive handling. Adopting cross-platform case-insensitive handling remains paused until the person has checked case-only path conflicts and rebuilt the local database.

### Database compatibility

- Continue to use the internal database version `VER` for changes which require explicit compatibility review. Changing the plug-in SemVer alone does not increment `VER`.
- Store the last acknowledged internal database version through Commonlib's device-local small-configuration contract under `database-compatibility-version`. Copy the legacy raw local-storage value into that contract once, then remove the legacy key after the copy has completed.
- Initialise the marker to the current `VER` only when Commonlib identifies a genuinely new Vault with no pending review. An existing Vault with a missing or invalid marker requires review instead of being silently accepted.
- Treat a missing marker on a configured Vault as an ambiguous device transition. Copying or restoring a Vault, or opening it with a new Obsidian profile, can preserve settings and database files without preserving device-local storage. Do not infer acknowledgement from an empty local database: a recovery operation, partial copy, or remote-first setup can also produce that state. Explain these cases and require an explicit decision in the compatibility dialogue.
- Derive one structured pause from the acknowledged database version, Commonlib's settings-migration state, and any persisted legacy review message. Persist the generic `versionUpFlash` message without changing any automatic synchronisation setting, because Commonlib already treats that field as a replication gate.
- Treat non-empty `versionUpFlash` as a runtime replication gate. Standard and one-shot replication must stop before remote work begins.
- Apply the same ordinary replication policy to P2P pull, push, and peer-requested synchronisation. An explicitly confirmed Fetch or Rebuild may bypass the ordinary policy because it is the operation selected to construct or recover the local state.
- Present the reason in a dedicated dialogue after the Obsidian layout is ready. The details view is explanatory only and returns to the summary before any decision can be made. The safe default and closing either dialogue keep synchronisation paused. A persistent Notice and a command allow the dialogue to be reopened without using the settings pane.
- Let the person read focused compatibility details without presenting the whole release history as a safety instruction. The Change Log remains a manually opened release-history pane and contains no compatibility acknowledgement control.
- Offer an explicit resume action only when every reason is recoverable in the running implementation. An upgrade, a missing or invalid marker on an existing Vault, and a reviewed migration from an older settings schema are resumable after all devices have been updated. A downgrade from a newer acknowledged `VER`, or settings saved by a future schema, cannot be acknowledged by the older installation.
- On resume, clear `versionUpFlash` and persist that fail-closed change before recording the current `VER` as acknowledged. If saving fails, restore the gate. Reapply settings only after the marker has advanced so that the previously configured synchronisation behaviour can resume without reconstruction.
- Preserve the original legacy review message as a structured reason when no more specific database or settings-schema reason is available. Escape it before including it in Markdown UI.
- Continue to reject a remote version document which is newer than the running implementation. That receiver-side check is independent of the local upgrade review.

### Onboarding activation and initialisation

- Keep an unconfigured Vault outside database initialisation, offline scanning, and configured-only checks. Offer setup through the long-lived onboarding Notice and the permanent command instead of opening a competing dialogue automatically.
- For new-device onboarding, reserve Rebuild before enabling and saving the accepted settings.
- For an unconfigured existing device, reserve Fetch before enabling and saving imported or manually confirmed settings.
- Suspend the current runtime after the flag has been written, apply the accepted settings through the scheduler's preparation callback, and request restart only after that callback succeeds.
- If the flag cannot be written, do not enable the settings. If preparation fails, remove the flag, resume the current runtime, and leave the transition incomplete.
- Applying compatible settings to an already configured device remains an ordinary edit and does not schedule Fetch automatically.

`isConfigured`, the Fetch and Rebuild flags, and in-memory suspension therefore retain separate meanings. `isConfigured` controls participation in ordinary processing, a flag selects a one-shot operation for the next start, and suspension prevents the old process from observing newly enabled settings before that selected restart.

### Flag-file recovery order

- Evaluate and persist the compatibility gate after settings load, before Obsidian layout-ready recovery begins. This blocks ordinary and one-shot replication even while the review dialogue has not yet opened.
- Preserve the existing ordered flag-file recovery handlers: SCRAM at priority 5, fetch-all at priority 10, and rebuild-all at priority 20. These files express an explicit recovery instruction and may invoke their focused storage or rebuild service while ordinary replication remains gated.
- Present the compatibility review at priority 30, after any selected recovery operation. A recovery handler which cancels start-up, keeps SCRAM active, or schedules a restart returns `false`, so the current process does not open a competing compatibility dialogue. If recovery completes and start-up continues, the dialogue opens before normal synchronisation is allowed to resume.
- Keep database preparation independent of an unanswered compatibility dialogue, because the compatibility gate already blocks replication. Before Config Doctor begins its interactive checks, await the active initial review so that the two update dialogues cannot overlap.
- Never mark compatibility as acknowledged merely because fetch, rebuild, or local database reset completed. The person must still use the explicit resume action. This keeps destructive recovery intent separate from protocol and settings compatibility acknowledgement.

## Consequences

- Ordinary releases no longer force the settings dialogue to show release notes. Important operational instructions must be clear in the published release notes and any explicit migration notice.
- SemVer pre-releases such as `1.0.0-rc.0` no longer require a special numeric encoding inside plug-in settings.
- An internal compatibility change remains fail-closed for replication, but it no longer destroys the person's synchronisation preferences.
- A new installation has no previous internal-version marker and therefore does not show an upgrade review. Its initial settings and onboarding remain responsible for keeping replication disabled until configuration is complete.
- A copied or restored configured Vault can show a one-time compatibility review on its new device or profile. This is intentional even when its local database appears empty, because emptiness does not prove how the Vault was produced.
- A genuinely new Vault receives current recommendations without applying them as fallbacks to an existing configuration. It remains inert until onboarding is accepted.
- Accepted new-device and existing-device setup cannot enable ordinary processing before the selected Rebuild or Fetch has been reserved.
- An older installation cannot dismiss evidence that a newer implementation or settings schema has already been used on the device.
- The Obsidian-specific dialogue depends only on a host-neutral compatibility result and the injected confirmation capability. Commonlib remains responsible for settings migration, device-local storage, and the replication gate.
- A future incompatible database change must increment `VER`, provide an actionable review message, verify the remote version negotiation, and test both the pending and acknowledged states. A major SemVer increase without those changes has no database-compatibility effect.

## Verification

- Unit tests verify new-Vault initialisation, upgrades, missing and invalid markers, downgrades, future settings schemas, legacy marker migration, acknowledgement ordering, and save-failure recovery while retaining automatic synchronisation choices.
- Commonlib package tests verify conservative stored-setting completion, independently mutable new-Vault settings, unresolved file-name case policy, future-schema protection, and the focused settings entry from a clean consumer.
- Host unit tests verify new-Vault factory use, conservative import paths, the unconfigured start-up gate, flag-before-settings ordering, rollback when the flag cannot be reserved, ordinary configured edits, and the explicit file-name case decision.
- Unit tests verify that a pending review is honoured by the packaged Commonlib replication service before remote activity begins.
- Unit and Compose tests verify that ordinary P2P replication observes the policy, explicit P2P rebuild uses the setup bypass, and replacement leaves host actions on the current replicator.
- A real-Obsidian settings test verifies the dedicated summary and details dialogues, captures representative screenshots, confirms that the acknowledged internal version advances only after explicit resume, and confirms that the Change Log contains no acknowledgement control.
- The real-Obsidian CouchDB workflow starts from configured plug-in data without a device-local marker, verifies the copied-or-restored Vault explanation, resumes through the actual dialogue, and then completes remote metadata, chunk, and activity checks. The two-Vault workflow performs the same review once per isolated Vault before reusing the acknowledged device state for later process launches.
- Unit tests fix the layout-ready priority after the three flag-file recovery priorities, so a recovery which stops start-up cannot race the compatibility dialogue.
