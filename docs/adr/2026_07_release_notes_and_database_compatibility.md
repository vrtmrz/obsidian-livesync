# Release notes and database compatibility gates

## Status

Accepted for the 1.0 release line.

## Context

Self-hosted LiveSync historically used two unrelated kinds of version state during start-up.

The plug-in SemVer was converted into a numeric major/minor value and stored in `lastReadUpdates`. The settings dialogue used that value to open the change log automatically, and offered a button which marked the release line as read. Patch versions were intentionally ignored. Pre-release identifiers containing an additional dot did not fit this numeric representation and could be interpreted as a much larger release line.

Separately, the internal database compatibility constant `VER` is recorded in device-local storage under a Vault-scoped key. Crossing this internal version used to set `versionUpFlash` and permanently change several automatic synchronisation settings to `false`. Replication services already reject work while `versionUpFlash` is non-empty, so changing the user's saved choices duplicated the runtime safety gate and required manual reconstruction after acknowledgement.

The remote `obsydian_livesync_version` document also carries the internal database version. It is a protocol and data-compatibility mechanism, not a copy of the plug-in SemVer.

## Decision

### Release notes

- Keep the change-log pane and render the current release history whenever it is opened.
- Remove automatic unread-version tracking, the acknowledgement button for ordinary release notes, and automatic navigation to the change-log pane.
- Do not derive data-compatibility behaviour from the plug-in's major, minor, patch, or pre-release identifiers.
- Retain the saved `lastReadUpdates` field in the settings schema for backwards compatibility, but do not use it in the plug-in. It can be removed through a separately reviewed settings-schema migration if retaining it later becomes burdensome.

### Database compatibility

- Continue to use the internal database version `VER` for changes which require explicit compatibility review. Changing the plug-in SemVer alone does not increment `VER`.
- Store the last acknowledged internal database version through Commonlib's device-local small-configuration contract under `database-compatibility-version`. Copy the legacy raw local-storage value into that contract once, then remove the legacy key after the copy has completed.
- Initialise the marker to the current `VER` only when Commonlib identifies a genuinely new Vault with no pending review. An existing Vault with a missing or invalid marker requires review instead of being silently accepted.
- Derive one structured pause from the acknowledged database version, Commonlib's settings-migration state, and any persisted legacy review message. Persist the generic `versionUpFlash` message without changing any automatic synchronisation setting, because Commonlib already treats that field as a replication gate.
- Treat non-empty `versionUpFlash` as a runtime replication gate. Standard and one-shot replication must stop before remote work begins.
- Present the reason in a dedicated dialogue after the Obsidian layout is ready. The details view is explanatory only and returns to the summary before any decision can be made. The safe default and closing either dialogue keep synchronisation paused. A persistent Notice and a command allow the dialogue to be reopened without using the settings pane.
- Let the person read focused compatibility details without presenting the whole release history as a safety instruction. The Change Log remains a manually opened release-history pane and contains no compatibility acknowledgement control.
- Offer an explicit resume action only when every reason is recoverable in the running implementation. An upgrade, a missing or invalid marker on an existing Vault, and a reviewed migration from an older settings schema are resumable after all devices have been updated. A downgrade from a newer acknowledged `VER`, or settings saved by a future schema, cannot be acknowledged by the older installation.
- On resume, clear `versionUpFlash` and persist that fail-closed change before recording the current `VER` as acknowledged. If saving fails, restore the gate. Reapply settings only after the marker has advanced so that the previously configured synchronisation behaviour can resume without reconstruction.
- Preserve the original legacy review message as a structured reason when no more specific database or settings-schema reason is available. Escape it before including it in Markdown UI.
- Continue to reject a remote version document which is newer than the running implementation. That receiver-side check is independent of the local upgrade review.

## Consequences

- Ordinary releases no longer force the settings dialogue to show release notes. Important operational instructions must be clear in the published release notes and any explicit migration notice.
- SemVer pre-releases such as `1.0.0-rc.0` no longer require a special numeric encoding inside plug-in settings.
- An internal compatibility change remains fail-closed for replication, but it no longer destroys the person's synchronisation preferences.
- A new installation has no previous internal-version marker and therefore does not show an upgrade review. Its initial settings and onboarding remain responsible for keeping replication disabled until configuration is complete.
- An older installation cannot dismiss evidence that a newer implementation or settings schema has already been used on the device.
- The Obsidian-specific dialogue depends only on a host-neutral compatibility result and the injected confirmation capability. Commonlib remains responsible for settings migration, device-local storage, and the replication gate.
- A future incompatible database change must increment `VER`, provide an actionable review message, verify the remote version negotiation, and test both the pending and acknowledged states. A major SemVer increase without those changes has no database-compatibility effect.

## Verification

- Unit tests verify new-Vault initialisation, upgrades, missing and invalid markers, downgrades, future settings schemas, legacy marker migration, acknowledgement ordering, and save-failure recovery while retaining automatic synchronisation choices.
- Unit tests verify that a pending review is honoured by the packaged Commonlib replication service before remote activity begins.
- A real-Obsidian settings test verifies the dedicated summary and details dialogues, captures representative screenshots, confirms that the acknowledged internal version advances only after explicit resume, and confirms that the Change Log contains no acknowledgement control.
