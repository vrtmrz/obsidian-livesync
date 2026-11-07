/**
 * Canonical English for LiveSync-owned messages whose wording is still being
 * exercised. These keys remain application-owned and must not be added to
 * Commonlib merely to make them available to the LiveSync translator.
 *
 * Japanese overrides may live in liveSyncProvisionalJapaneseMessages while a
 * key remains provisional. Move a message to the YAML catalogue when its wording
 * is ready for the full translation workflow, and remove it from both maps in
 * the same change.
 */
export const liveSyncProvisionalEnglishMessages = {
    "Diagnostic summary": "Diagnostic summary",
    "Open log": "Open log",
    "Detailed P2P diagnostics and Log Pane output are enabled":
        "Detailed P2P diagnostics and Log Pane output are enabled",
    "Enable detailed P2P diagnostics and Log Pane output":
        "Enable detailed P2P diagnostics and Log Pane output",
    "Enable SyncGuard": "Enable SyncGuard",
    "Enable device-local SyncGuard protection during synchronisation.":
        "Enable device-local SyncGuard protection during synchronisation.",
    "SyncGuard minimum files": "SyncGuard minimum files",
    "Minimum number of Vault files required for SyncGuard protection to apply.":
        "Minimum number of Vault files required for SyncGuard protection to apply.",
    "Skip stopped Journal and resume": "Skip stopped Journal and resume",
    "Object Storage only. Confirm to skip the currently stopped Journal and resume replication. The confirmation names the exact Journal key and failure stage. Skipping may leave content or history missing; the next Journal failure still stops replication.":
        "Object Storage only. Confirm to skip the currently stopped Journal and resume replication. The confirmation names the exact Journal key and failure stage. Skipping may leave content or history missing; the next Journal failure still stops replication.",
    "Skip and resume": "Skip and resume",
    "No stopped Journal is available. Retry replication to identify the stopped Journal.":
        "No stopped Journal is available. Retry replication to identify the stopped Journal.",
    "Skip stopped Journal '${KEY}' at failure stage '${STAGE}' and resume replication? This may leave content or history missing.":
        "Skip stopped Journal '${KEY}' at failure stage '${STAGE}' and resume replication? This may leave content or history missing.",
    "The active replicator changed. Retry replication to identify the stopped Journal.":
        "The active replicator changed. Retry replication to identify the stopped Journal.",
    "Journal receipt did not complete after this action. Check the current failure before retrying.":
        "Journal receipt did not complete after this action. Check the current failure before retrying.",
    "File identity": "File identity",
    "Version 0 preserves legacy path identity; version 1 uses Unicode NFC. Physical file names stay unchanged. Update every device and stop synchronisation, then Rebuild from a complete authoritative Vault and Fetch on the other devices. With P2P, Rebuild prepares only the source device's local database. Resolve colliding file names first.":
        "Version 0 preserves legacy path identity; version 1 uses Unicode NFC. Physical file names stay unchanged. Update every device and stop synchronisation, then Rebuild from a complete authoritative Vault and Fetch on the other devices. With P2P, Rebuild prepares only the source device's local database. Resolve colliding file names first.",
    "Synchronisation protection": "Synchronisation protection",
    "Synchronising your Vault": "Synchronising your Vault",
    "Receiving changes from the server…": "Receiving changes from the server…",
    "Applying received changes to local notes…": "Applying received changes to local notes…",
    "Synchronisation was interrupted. You can continue locally, but some notes may be out of date.":
        "Synchronisation was interrupted. You can continue locally, but some notes may be out of date.",
    "At least ${COUNT} changed files received": "At least ${COUNT} changed files received",
    "Continue without waiting": "Continue without waiting",
    "Hidden File Sync is disabled on this device. Enable it in Sync Settings before using Automatic or initialising hidden files.":
        "Hidden File Sync is disabled on this device. Enable it in Sync Settings before using Automatic or initialising hidden files.",
    "Hidden File Sync initialisation was not started.": "Hidden File Sync initialisation was not started.",
    "(RegExp) Limit normal files to matching paths. Leave empty to allow all normal file paths. Hidden File Sync uses its own target patterns.":
        "(RegExp) Limit normal files to matching paths. Leave empty to allow all normal file paths. Hidden File Sync uses its own target patterns.",
    "(RegExp) Skip changes to matching normal and hidden files, locally and remotely.":
        "(RegExp) Skip changes to matching normal and hidden files, locally and remotely.",
    "Unknown platform": "Unknown platform",
    "This removes only this device's record from the remote.":
        "This removes only this device's record from the remote.",
    "This remote is unlocked. A device that returns can register again.":
        "This remote is unlocked. A device that returns can register again.",
    "This remote is locked. Use the existing recovery process for devices that need to join again.":
        "This remote is locked. Use the existing recovery process for devices that need to join again.",
    "This remote is locked. If the device returns, use the existing recovery process to join it again.":
        "This remote is locked. If the device returns, use the existing recovery process to join it again.",
    "This remote does not support conditional updates, so the device record could not be removed.":
        "This remote does not support conditional updates, so the device record could not be removed.",
    "This remote does not currently have a record of joined devices.":
        "This remote does not currently have a record of joined devices.",
    "This list shows device information recorded by the remote. It does not show whether a device is online now.":
        "This list shows device information recorded by the remote. It does not show whether a device is online now.",
    "This device has been locked out. Use the existing recovery process to join again.":
        "This device has been locked out. Use the existing recovery process to join again.",
    "This device": "This device",
    "This remote has been cleaned. Use the existing recovery process to join devices again as needed.":
        "This remote has been cleaned. Use the existing recovery process to join devices again as needed.",
    "The device record was forgotten.": "The device record was forgotten.",
    "The device record was already absent.": "The device record was already absent.",
    "The device list changed while you were trying to forget this device. Refresh the list before trying again.":
        "The device list changed while you were trying to forget this device. Refresh the list before trying again.",
    "The device information could not be loaded. Close this dialogue and open Joined devices again if the remote configuration has changed.":
        "The device information could not be loaded. Close this dialogue and open Joined devices again if the remote configuration has changed.",
    "Review device records for the active CouchDB or Object Storage connection.":
        "Review device records for the active CouchDB or Object Storage connection.",
    Refresh: "Refresh",
    "Plug-in version": "Plug-in version",
    Platform: "Platform",
    "Older Self-hosted LiveSync versions detected: ${versions}.":
        "Older Self-hosted LiveSync versions detected: ${versions}.",
    "Newer Self-hosted LiveSync versions detected: ${versions}.":
        "Newer Self-hosted LiveSync versions detected: ${versions}.",
    "Reviewing and aligning Self-hosted LiveSync versions across devices is recommended.":
        "Reviewing and aligning Self-hosted LiveSync versions across devices is recommended.",
    Open: "Open",
    "Not recorded": "Not recorded",
    "Not accepted": "Not accepted",
    "No joined devices are recorded on this remote.": "No joined devices are recorded on this remote.",
    "Locked out": "Locked out",
    "Loading joined devices…": "Loading joined devices…",
    "Last recorded": "Last recorded",
    "Joined devices could not be updated. Refresh the list and try again. If the remote configuration has changed, close this dialogue and open Joined devices again.":
        "Joined devices could not be updated. Refresh the list and try again. If the remote configuration has changed, close this dialogue and open Joined devices again.",
    "Joined devices are available after database startup with an active CouchDB or Object Storage connection.":
        "Joined devices are available after database startup with an active CouchDB or Object Storage connection.",
    "Joined devices": "Joined devices",
    "Review devices": "Review devices",
    "Synchronisation between different plug-in versions is generally safe unless the connection is explicitly blocked. However, it may be less efficient or use more storage, and P2P synchronisation may be unavailable.":
        "Synchronisation between different plug-in versions is generally safe unless the connection is explicitly blocked. However, it may be less efficient or use more storage, and P2P synchronisation may be unavailable.",
    "Forgetting…": "Forgetting…",
    "Forgetting the record does not delete Vault files or revoke credentials.":
        "Forgetting the record does not delete Vault files or revoke credentials.",
    "Forget this device record?": "Forget this device record?",
    "Forget device": "Forget device",
    Close: "Close",
    Cancel: "Cancel",
    "App version": "App version",
    Accepted: "Accepted",
    "Preparing follow-up report…": "Preparing follow-up report…",
    "Cancelling local search. Checked ${COUNT} entries.": "Cancelling local search. Checked ${COUNT} entries.",
    "Search current Vault paths and current local Metadata only. Older history and remote-only files are not searched.":
        "Search current Vault paths and current local Metadata only. Older history and remote-only files are not searched.",
    "The lookup does not read file contents or contact a remote database. Follow-up reports include current conflicts and merge bases.":
        "The lookup does not read file contents or contact a remote database. Follow-up reports include current conflicts and merge bases.",
    "Local file diagnostic report": "Local file diagnostic report",
    "Checked ${COUNT} local entries.": "Checked ${COUNT} local entries.",
    "Enter a valid report path pseudonym.": "Enter a valid report path pseudonym.",
    "Search cancelled. Matches found so far are shown.": "Search cancelled. Matches found so far are shown.",
    "No matches were found in current Vault paths or current local Metadata. Older history and remote-only files are not searched.":
        "No matches were found in current Vault paths or current local Metadata. Older history and remote-only files are not searched.",
    "Found ${COUNT} local matches.": "Found ${COUNT} local matches.",
    "The local search could not finish.": "The local search could not finish.",
    "The file could not be opened.": "The file could not be opened.",
    "The follow-up report could not be prepared.": "The follow-up report could not be prepared.",
    "Report path pseudonym": "Report path pseudonym",
    Source: "Source",
    Metadata: "Metadata",
    Vault: "Vault",
    "Metadata document ID": "Metadata document ID",
    "No current Metadata document": "No current Metadata document",
    "Current Vault file": "Current Vault file",
    Present: "Present",
    Missing: "Missing",
    "Open file": "Open file",
    "Prepare follow-up report": "Prepare follow-up report",
    "This report uses pseudonyms. Review its coverage before sharing.":
        "This report uses pseudonyms. Review its coverage before sharing.",
    "Back to matches": "Back to matches",
    "Reading revisions": "Reading revisions",
    "Calculating database usage": "Calculating database usage",
    "Discovering revisions": "Discovering revisions",
    "Find a file from a report pseudonym": "Find a file from a report pseudonym",
    "Find matching paths in this Vault and local Metadata, then prepare a follow-up report using the same pseudonyms.":
        "Find matching paths in this Vault and local Metadata, then prepare a follow-up report using the same pseudonyms.",
    "Find file": "Find file",
    "⚠️ Initialise or overwrite the remote": "⚠️ Initialise or overwrite the remote",
    "🔗 Join this device": "🔗 Join this device",
    "⚙️ Apply settings only (advanced)": "⚙️ Apply settings only (advanced)",
    "Configure TURN when a direct connection cannot be established or when you select TURN relay only.":
        "Configure TURN when a direct connection cannot be established or when you select TURN relay only.",
    "TURN configuration": "TURN configuration",
    Manual: "Manual",
    "Managed (Cloudflare)": "Managed (Cloudflare)",
    "TURN Key ID": "TURN Key ID",
    "TURN Key API Token": "TURN Key API Token",
    "Unsupported TURN configuration": "Unsupported TURN configuration",
    "The API token is saved with this profile and included in Setup URI and QR code sharing. Temporary TURN credentials are kept in memory only.":
        "The API token is saved with this profile and included in Setup URI and QR code sharing. Temporary TURN credentials are kept in memory only.",
    "TURN relay only requires a TURN server or a configured credential source under Advanced Settings.":
        "TURN relay only requires a TURN server or a configured credential source under Advanced Settings.",
    "TURN relay only requires TURN configuration. Connection path has been restored to Automatic.":
        "TURN relay only requires TURN configuration. Connection path has been restored to Automatic.",
    "Enter a TURN Key ID.": "Enter a TURN Key ID.",
    "TURN Key ID contains unsupported characters.": "TURN Key ID contains unsupported characters.",
    "Enter a TURN Key API Token.": "Enter a TURN Key API Token.",
    "TURN Key API Token must use Bearer token syntax.": "TURN Key API Token must use Bearer token syntax.",
    "The selected TURN configuration is not supported.": "The selected TURN configuration is not supported.",

    "Setup Complete: Preparing to Fetch from Another Device": "Setup Complete: Preparing to Fetch from Another Device",
    "The P2P connection has been configured successfully. The initial synchronisation data must now be fetched from an online source device.":
        "The P2P connection has been configured successfully. The initial synchronisation data must now be fetched from an online source device.",
    "After restarting, select an online source device for the initial Fetch. The local LiveSync database on this device will be rebuilt from that source. Unsynchronised files in this Vault may conflict with the fetched data.":
        "After restarting, select an online source device for the initial Fetch. The local LiveSync database on this device will be rebuilt from that source. Unsynchronised files in this Vault may conflict with the fetched data.",
    "Restart this device, then choose the source device when P2P Rebuild opens.":
        "Restart this device, then choose the source device when P2P Rebuild opens.",
    "Restart and Select Source Device": "Restart and Select Source Device",
    "P2P Status pane": "P2P Status pane",
    "No central data-storage server is required, but a signalling relay is required for peer discovery. Both devices must be online at the same time. Vault data travels through the encrypted P2P connection, not through the signalling relay. Some features may be limited.":
        "No central data-storage server is required, but a signalling relay is required for peer discovery. Both devices must be online at the same time. Vault data travels through the encrypted P2P connection, not through the signalling relay. Some features may be limited.",
    "P2P requires no central data-storage server, but it still uses a signalling relay for peer discovery.":
        "P2P requires no central data-storage server, but it still uses a signalling relay for peer discovery.",
    "Signalling relay URLs": "Signalling relay URLs",
    "Peer discovery uses Nostr-compatible signalling relays.":
        "Peer discovery uses Nostr-compatible signalling relays.",
    "Use the project's public signalling relay": "Use the project's public signalling relay",
    "The project's public signalling relay is a best-effort convenience operated by the project author. It does not store Vault contents, but signalling metadata may be visible to the relay. Availability and log retention are not guaranteed. You can replace it with your own Nostr-compatible relay.":
        "The project's public signalling relay is a best-effort convenience operated by the project author. It does not store Vault contents, but signalling metadata may be visible to the relay. Availability and log retention are not guaranteed. You can replace it with your own Nostr-compatible relay.",
    "Learn more about P2P connections": "Learn more about P2P connections",
    "Learn more about signalling and TURN": "Learn more about signalling and TURN",
    "WebRTC encrypts data between your devices, including when it passes through TURN. The TURN provider cannot read the transferred data. It can see network addresses and traffic volume.":
        "WebRTC encrypts data between your devices, including when it passes through TURN. The TURN provider cannot read the transferred data. It can see network addresses and traffic volume.",
    "Connection compatibility": "Connection compatibility",
    "P2P message size": "P2P message size",
    Standard: "Standard",
    Reduced: "Reduced",
    Conservative: "Conservative",
    "Maximum compatibility": "Maximum compatibility",
    "Smaller messages can improve compatibility on paths which fragment or drop larger WebRTC messages. This setting limits outgoing P2P messages, so use a compatible profile on each sending device when required.":
        "Smaller messages can improve compatibility on paths which fragment or drop larger WebRTC messages. This setting limits outgoing P2P messages, so use a compatible profile on each sending device when required.",
    "Connection path": "Connection path",
    "TURN relay only": "TURN relay only",
    "TURN relay only is available when at least one valid TURN server URL is configured under Advanced Settings.":
        "TURN relay only is available when at least one valid TURN server URL is configured under Advanced Settings.",
    "TURN relay only requires at least one valid TURN server URL. Connection path has been restored to Automatic.":
        "TURN relay only requires at least one valid TURN server URL. Connection path has been restored to Automatic.",
    "Announce changes": "Announce changes",
    "Announce changes automatically after connecting": "Announce changes automatically after connecting",
    "When enabled, this device notifies connected peers after a local change. The notification contains no Vault data; a peer which follows this device then fetches the change through the encrypted P2P connection.":
        "When enabled, this device notifies connected peers after a local change. The notification contains no Vault data; a peer which follows this device then fetches the change through the encrypted P2P connection.",
    "Stop announcing changes": "Stop announcing changes",
    "Start announcing changes": "Start announcing changes",
    "Follow changes": "Follow changes",
    "Stop following changes from this device": "Stop following changes from this device",
    "Follow changes from this device": "Follow changes from this device",
    "Synchronise when this device connects": "Synchronise when this device connects",
    "Follow whenever this device connects": "Follow whenever this device connects",
    "Include in the P2P synchronisation command": "Include in the P2P synchronisation command",
    "More actions for ${DEVICE}": "More actions for ${DEVICE}",
    "Use this device's settings": "Use this device's settings",
    Retry: "Retry",
    "No Synchronisation Settings Found": "No Synchronisation Settings Found",
    "The selected remote has no saved synchronisation settings. This is normal for a new remote. Use this device's settings, or cancel if you expected existing settings.":
        "The selected remote has no saved synchronisation settings. This is normal for a new remote. Use this device's settings, or cancel if you expected existing settings.",
    "Could Not Read Synchronisation Settings": "Could Not Read Synchronisation Settings",
    "Could not read the remote's synchronisation settings. Check the connection and credentials, then retry.":
        "Could not read the remote's synchronisation settings. Check the connection and credentials, then retry.",
    "Could not read the remote's synchronisation settings. Retry, or continue the overwrite with this device's settings. A working connection is still required.":
        "Could not read the remote's synchronisation settings. Retry, or continue the overwrite with this device's settings. A working connection is still required.",
    "Skips checking and applying synchronisation settings from the remote.":
        "Skips checking and applying synchronisation settings from the remote.",
    "Change CouchDB server setting": "Change CouchDB server setting",
    "Change CouchDB server setting '${SETTING}' to '${VALUE}'?":
        "Change CouchDB server setting '${SETTING}' to '${VALUE}'?",
    "This file has unresolved conflicts.": "This file has unresolved conflicts.",
    "This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.":
        "This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.",
    "Sync now": "Sync now",
    "Apply pending changes now": "Apply pending changes now",
    "Copy database information for the active file": "Copy database information for the active file",
    "Copy database information for a file": "Copy database information for a file",
    "Copy revision, conflict, and local chunk availability information, including document and chunk identifiers but not file contents.":
        "Copy revision, conflict, and local chunk availability information, including document and chunk identifiers but not file contents.",
    "Choose file": "Choose file",
    "Choose a file to inspect": "Choose a file to inspect",
    "Database information for ${FILE}": "Database information for ${FILE}",
    "All revisions and chunk availability below are a snapshot of this device's local database; the remote is not queried. Review the Vault-relative path, document identifier, content-derived chunk identifiers, and metadata before sharing this report. File contents are omitted.":
        "All revisions and chunk availability below are a snapshot of this device's local database; the remote is not queried. Review the Vault-relative path, document identifier, content-derived chunk identifiers, and metadata before sharing this report. File contents are omitted.",
    "📁 Vault: ${SIZE} B · ${TIME}": "📁 Vault: ${SIZE} B · ${TIME}",
    "📁 Vault: missing": "📁 Vault: missing",
    "🗄️ Local DB: missing": "🗄️ Local DB: missing",
    "Vault and database revision": "Vault and database revision",
    "Vault file": "Vault file",
    "Database revision": "Database revision",
    "Vault file is newer": "Vault file is newer",
    "Database revision is newer": "Database revision is newer",
    "Within the two-second comparison window": "Within the two-second comparison window",
    "Timestamp comparison unavailable": "Timestamp comparison unavailable",
    "${ROLE}: ${REVISION}": "${ROLE}: ${REVISION}",
    "Winner revision": "Winner revision",
    "Conflict revision": "Conflict revision",
    "Unknown revision": "Unknown revision",
    "🗑️ Logical deletion": "🗑️ Logical deletion",
    "Readable on this device; recorded size ${RECORDED}, decoded size ${ACTUAL}":
        "Readable on this device; recorded size ${RECORDED}, decoded size ${ACTUAL}",
    "🧩 Missing chunks: ${COUNT}": "🧩 Missing chunks: ${COUNT}",
    "📦 DB: recorded ${RECORDED} B · decoded ${DECODED} B · Δsize ${DIFFERENCE} B":
        "📦 DB: recorded ${RECORDED} B · decoded ${DECODED} B · Δsize ${DIFFERENCE} B",
    "📦 DB: recorded ${RECORDED} B · decoded unavailable": "📦 DB: recorded ${RECORDED} B · decoded unavailable",
    "📁 Vault: ${VAULT} B · Δsize vs DB ${DIFFERENCE} B": "📁 Vault: ${VAULT} B · Δsize vs DB ${DIFFERENCE} B",
    "🕒 DB ${DATABASE_TIME} · Vault ${VAULT_TIME} · Δtime ${DIFFERENCE} ms (${RELATION})":
        "🕒 DB ${DATABASE_TIME} · Vault ${VAULT_TIME} · Δtime ${DIFFERENCE} ms (${RELATION})",
    "✅ Matches Vault": "✅ Matches Vault",
    "⚠️ Differs from Vault": "⚠️ Differs from Vault",
    "✅ Vault matches winner": "✅ Vault matches winner",
    "⚠️ Conflicts: ${COUNT}": "⚠️ Conflicts: ${COUNT}",
    "Compare with Vault": "Compare with Vault",
    "Apply this revision to Vault": "Apply this revision to Vault",
    "Apply database revision ${REVISION} to ${FILE}? The current Vault file will be overwritten.":
        "Apply database revision ${REVISION} to ${FILE}? The current Vault file will be overwritten.",
    "Apply database revision to Vault": "Apply database revision to Vault",
    "Mark this revision as the Vault version": "Mark this revision as the Vault version",
    "Store Vault file as a child of this revision": "Store Vault file as a child of this revision",
    "Correct recorded file size": "Correct recorded file size",
    "Apply logical deletion to Vault": "Apply logical deletion to Vault",
    "Apply logical deletion ${REVISION} to ${FILE}? The current Vault file will be removed.":
        "Apply logical deletion ${REVISION} to ${FILE}? The current Vault file will be removed.",
    "Retry reading revision": "Retry reading revision",
    "Discard this branch": "Discard this branch",
    "Discard branch": "Discard branch",
    "Discard database branch ${REVISION} of ${FILE}? This creates a logical deletion for that exact live branch. The current Vault file will not be changed.":
        "Discard database branch ${REVISION} of ${FILE}? This creates a logical deletion for that exact live branch. The current Vault file will not be changed.",
    "Discard unreadable revision": "Discard unreadable revision",
    "Discard database revision ${REVISION} of ${FILE}? This creates a logical deletion for that exact live revision. Missing content cannot be recovered by this action.":
        "Discard database revision ${REVISION} of ${FILE}? This creates a logical deletion for that exact live revision. Missing content cannot be recovered by this action.",
    "Revision metadata is unavailable on this device": "Revision metadata is unavailable on this device",
    "Shared ancestor ${REVISION} is not readable on this device. Automatic three-way merging may be unavailable, but the live revisions remain available for explicit review.":
        "Shared ancestor ${REVISION} is not readable on this device. Automatic three-way merging may be unavailable, but the live revisions remain available for explicit review.",
    "No shared ancestor is available for this conflict. The live revisions remain available for explicit review.":
        "No shared ancestor is available for this conflict. The live revisions remain available for explicit review.",
    "More actions for revision ${REVISION}": "More actions for revision ${REVISION}",
    "More actions for ${FILE}": "More actions for ${FILE}",
    "Show revision history": "Show revision history",
    "Store Vault file as a new local database document": "Store Vault file as a new local database document",
    "Copy database information": "Copy database information",
    "Recreate chunks for current Vault files": "Recreate chunks for current Vault files",
    "Recreate chunks from the files currently present in this Vault. This cannot reconstruct unavailable historical or conflict content.":
        "Recreate chunks from the files currently present in this Vault. This cannot reconstruct unavailable historical or conflict content.",
    "Recreate current chunks": "Recreate current chunks",
    "Resolve every conflict by modification time? This logically deletes every version except the newest one and cannot recover content which is already unavailable.":
        "Resolve every conflict by modification time? This logically deletes every version except the newest one and cannot recover content which is already unavailable.",
    "Resolve all conflicts by the newest version": "Resolve all conflicts by the newest version",
    "Inspect conflicts and file/database differences": "Inspect conflicts and file/database differences",
    "Scan Vault files and local-database Metadata for conflicts, missing chunks, identity mismatches, and differences. Each result provides actions for one exact entry or revision.":
        "Scan Vault files and local-database Metadata for conflicts, missing chunks, identity mismatches, and differences. Each result provides actions for one exact entry or revision.",
    "Begin inspection": "Begin inspection",
    "Metadata entry requires review and was left unchanged": "Metadata entry requires review and was left unchanged",
    "The stored document ID does not match the ID derived from its recorded path.":
        "The stored document ID does not match the ID derived from its recorded path.",
    "The stored document ID and recorded path are handled by different synchronisation features.":
        "The stored document ID and recorded path are handled by different synchronisation features.",
    "Stored document ID: ${ID}": "Stored document ID: ${ID}",
    "Expected document ID: ${ID}": "Expected document ID: ${ID}",
    "Source revision: ${REVISION}": "Source revision: ${REVISION}",
    "One-step repair is unavailable because this entry is ambiguous, no longer current, or unsafe to change.":
        "One-step repair is unavailable because this entry is ambiguous, no longer current, or unsafe to change.",
    "An exact target is already present; repair can remove the obsolete ID.":
        "An exact target is already present; repair can remove the obsolete ID.",
    "Repair is available for this entry.": "Repair is available for this entry.",
    "Repair this Metadata document ID": "Repair this Metadata document ID",
    "Repair Metadata ID": "Repair Metadata ID",
    "Keep unchanged": "Keep unchanged",
    "Repair Metadata document ID": "Repair Metadata document ID",
    "This moves one local Metadata entry to the ID derived from its recorded path.\n\n**File:** `${FILE}`  \n**Source:** `${SOURCE}@${REVISION}`  \n**Target:** `${TARGET}`\n\nThe target is verified before the source is removed. Its CouchDB revision ancestry cannot be preserved.\n\n> [!warning] Before repairing\n> - Back up this device.\n> - If file-name case or path obfuscation was intentionally changed for the whole database, use Rebuild instead.\n> - If other devices share this database, pause them, allow this device to upload the repair, then resume them one at a time.":
        "This moves one local Metadata entry to the ID derived from its recorded path.\n\n**File:** `${FILE}`  \n**Source:** `${SOURCE}@${REVISION}`  \n**Target:** `${TARGET}`\n\nThe target is verified before the source is removed. Its CouchDB revision ancestry cannot be preserved.\n\n> [!warning] Before repairing\n> - Back up this device.\n> - If file-name case or path obfuscation was intentionally changed for the whole database, use Rebuild instead.\n> - If other devices share this database, pause them, allow this device to upload the repair, then resume them one at a time.",
    "Metadata document ID repair and the ordinary Vault scan completed. Run this inspection again after synchronisation.":
        "Metadata document ID repair and the ordinary Vault scan completed. Run this inspection again after synchronisation.",
    "Metadata document ID repair completed, but the ordinary Vault scan did not run. Keep synchronisation paused, resolve the scan condition, then run 'Scan storage and database again'.":
        "Metadata document ID repair completed, but the ordinary Vault scan did not run. Keep synchronisation paused, resolve the scan condition, then run 'Scan storage and database again'.",
    "The inspected state changed. No repair was performed; run inspection again.":
        "The inspected state changed. No repair was performed; run inspection again.",
    "Repair stopped after creating the target. The source was retained. Run inspection again before retrying.":
        "Repair stopped after creating the target. The source was retained. Run inspection again before retrying.",
    "Repair failed before the source was removed. Run inspection again before retrying.":
        "Repair failed before the source was removed. Run inspection again before retrying.",
    "Connection settings": "Connection settings",
    "Saved connections": "Saved connections",
    "ID generation": "ID generation",
    "Keep current configuration": "Keep current configuration",
    "Set an ID key": "Set an ID key",
    "Current configuration: a saved ID key is used.": "Current configuration: a saved ID key is used.",
    "Current configuration: the saved ID key is retained while E2EE is off.":
        "Current configuration: the saved ID key is retained while E2EE is off.",
    "Current configuration: no ID key is saved. With E2EE enabled, keeping it uses legacy IDs tied to the E2EE passphrase.":
        "Current configuration: no ID key is saved. With E2EE enabled, keeping it uses legacy IDs tied to the E2EE passphrase.",
    "Changing the E2EE passphrase changes IDs generated by the legacy configuration.":
        "Changing the E2EE passphrase changes IDs generated by the legacy configuration.",
    "This uses a saved key for new Chunk IDs and obfuscated Metadata document IDs, so changing the E2EE passphrase does not derive a new key automatically.":
        "This uses a saved key for new Chunk IDs and obfuscated Metadata document IDs, so changing the E2EE passphrase does not derive a new key automatically.",
    Configured: "Configured",
    "The saved ID key is configured. Its source cannot be shown again.":
        "The saved ID key is configured. Its source cannot be shown again.",
    "Leave this input empty to keep the saved ID key.": "Leave this input empty to keep the saved ID key.",
    "Generate a random ID key": "Generate a random ID key",
    "How to set the ID key": "How to set the ID key",
    "Derive from current E2EE passphrase": "Derive from current E2EE passphrase",
    "Enter an ID source": "Enter an ID source",
    "Import an ID recovery code": "Import an ID recovery code",
    "ID source": "ID source",
    "ID recovery code": "ID recovery code",
    "Enter an ID recovery code": "Enter an ID recovery code",
    "Choose a long, unpredictable source. It is used once and cannot be shown again after saving. A recovery code can be displayed on this device later. This input also accepts a tagged recovery code.":
        "Choose a long, unpredictable source. It is used once and cannot be shown again after saving. A recovery code can be displayed on this device later. This input also accepts a tagged recovery code.",
    "Paste a tagged recovery code from an existing device to restore the same ID key.":
        "Paste a tagged recovery code from an existing device to restore the same ID key.",
    "For recovery after losing every device, save the recovery code after setup or choose an ID source you can reproduce.":
        "For recovery after losing every device, save the recovery code after setup or choose an ID source you can reproduce.",
    "Show current recovery code": "Show current recovery code",
    "Hide current recovery code": "Hide current recovery code",
    "Current ID recovery code": "Current ID recovery code",
    "Copy recovery code": "Copy recovery code",
    "Recovery code copied.": "Recovery code copied.",
    "The displayed recovery code belongs to the current key. Reopen this dialogue after saving to copy the replacement key.":
        "The displayed recovery code belongs to the current key. Reopen this dialogue after saving to copy the replacement key.",
    "The recovery code could not be copied. Select and copy the visible code instead.":
        "The recovery code could not be copied. Select and copy the visible code instead.",
    "The ID key is derived from the current E2EE passphrase and saved separately. Changing that passphrase later does not change the saved ID key. To reduce the risk of guessing that passphrase from known IDs, use a separate, unpredictable ID source instead.":
        "The ID key is derived from the current E2EE passphrase and saved separately. Changing that passphrase later does not change the saved ID key. To reduce the risk of guessing that passphrase from known IDs, use a separate, unpredictable ID source instead.",
    "An ID source is required to enable this option.": "An ID source is required to enable this option.",
    "The ID source or recovery code is invalid. Check it and try again.":
        "The ID source or recovery code is invalid. Check it and try again.",
    "Read normal-file Metadata and current conflicts locally and in CouchDB, then compare content for suspect groups. Choose original names or pseudonyms before starting.":
        "Read normal-file Metadata and current conflicts locally and in CouchDB, then compare content for suspect groups. Choose original names or pseudonyms before starting.",
    Inspect: "Inspect",
    "Inspect database integrity": "Inspect database integrity",
    "Inspection completed. Review the findings and coverage before sharing.":
        "Inspection completed. Review the findings and coverage before sharing.",
    "Inspection partially completed. Some information could not be checked; review the reported reasons.":
        "Inspection partially completed. Some information could not be checked; review the reported reasons.",
    "Inspection failed. The report records the available evidence and reasons.":
        "Inspection failed. The report records the available evidence and reasons.",
    "Inspection cancelled. The report contains only the evidence collected so far.":
        "Inspection cancelled. The report contains only the evidence collected so far.",
    "Report copied.": "Report copied.",
    "Copy failed. Select the report text and copy it manually.":
        "Copy failed. Select the report text and copy it manually.",
    "Download requested. You can also copy the report if downloads are unavailable on this device.":
        "Download requested. You can also copy the report if downloads are unavailable on this device.",
    "Pseudonyms include a public salt, so guessed paths can be checked. Original names include private filenames. Reports omit file contents and credentials.":
        "Pseudonyms include a public salt, so guessed paths can be checked. Original names include private filenames. Reports omit file contents and credentials.",
    "Read available local revisions and report their Chunk references. Settings are left unchanged.":
        "Read available local revisions and report their Chunk references. Settings are left unchanged.",
    "Inspect normal-file Metadata, current conflicts, and suspect content against the Vault. Remote inspection supports CouchDB. Older history is excluded; findings do not authorise deletion.":
        "Inspect normal-file Metadata, current conflicts, and suspect content against the Vault. Remote inspection supports CouchDB. Older history is excluded; findings do not authorise deletion.",
    "Include remote database": "Include remote database",
    "Names in this report": "Names in this report",
    "Pseudonyms (recommended)": "Pseudonyms (recommended)",
    "Original names": "Original names",
    "Cancelling inspection…": "Cancelling inspection…",
    "Items inspected": "Items inspected",
    "Cancel inspection": "Cancel inspection",
    "This report uses temporary pseudonyms. Counts and relationships remain visible.":
        "This report uses temporary pseudonyms. Counts and relationships remain visible.",
    "This report contains original paths and identifiers. Review them before sharing.":
        "This report contains original paths and identifiers. Review them before sharing.",
    "Partial Usage results are available as JSON so their coverage and reasons stay with the rows.":
        "Partial Usage results are available as JSON so their coverage and reasons stay with the rows.",
    "Report format": "Report format",
    "Diagnostic report": "Diagnostic report",
    "Copy report": "Copy report",
    "Save report": "Save report",
    "The inspection could not finish. Close this dialogue and try again after database startup.":
        "The inspection could not finish. Close this dialogue and try again after database startup.",
    "Resume scheduled fetch?": "Resume scheduled fetch?",
    "Apply these saved choices to the current remote?\n\nCurrent remote: ${REMOTE}\n\n- ${STAGE1}\n- ${STAGE2}\n\nThe fetch flag may remain after an interruption or an incomplete cleanup. Continue only if this fetch is still intended.":
        "Apply these saved choices to the current remote?\n\nCurrent remote: ${REMOTE}\n\n- ${STAGE1}\n- ${STAGE2}\n\nThe fetch flag may remain after an interruption or an incomplete cleanup. Continue only if this fetch is still intended.",
    "Continue with these choices": "Continue with these choices",
    "Choose again": "Choose again",
    "Saved fetch choices could not be read": "Saved fetch choices could not be read",
    "The fetch flag does not contain one supported selection. Choose new options and continue with the current remote?\n\nCurrent remote: ${REMOTE}\n\nThe flag contents will remain unchanged. The new choices apply only to this attempt; another restart will ask again. Completing or cancelling the fetch removes the flag.":
        "The fetch flag does not contain one supported selection. Choose new options and continue with the current remote?\n\nCurrent remote: ${REMOTE}\n\nThe flag contents will remain unchanged. The new choices apply only to this attempt; another restart will ask again. Completing or cancelling the fetch removes the flag.",
    "Choose new options and continue": "Choose new options and continue",
    "Batch database updates in LiveSync mode": "Batch database updates in LiveSync mode",
    "Wait for a bounded local quiet period before processing file updates in LiveSync mode, reducing intermediate database updates while delaying their reflection to remote devices.":
        "Wait for a bounded local quiet period before processing file updates in LiveSync mode, reducing intermediate database updates while delaying their reflection to remote devices.",
    Apply: "Apply",
    Add: "Add",
    Revert: "Revert",
    "Vault history": "Vault history",
    "From:": "From:",
    "To:": "To:",
    "Info:": "Info:",
    "To stop the countdown, tap anywhere on the dialogue": "To stop the countdown, tap anywhere on the dialogue",
} as const;

export type LiveSyncProvisionalMessageKey = keyof typeof liveSyncProvisionalEnglishMessages;

/** Japanese translations for provisional LiveSync messages which are already user-facing. */
export const liveSyncProvisionalJapaneseMessages: Partial<Record<LiveSyncProvisionalMessageKey, string>> = {
    "Enable SyncGuard": "SyncGuard を有効化",
    "Enable device-local SyncGuard protection during synchronisation.":
        "同期中に、このデバイスで SyncGuard による保護を有効にします。",
    "SyncGuard minimum files": "SyncGuard を適用する最小ファイル数",
    "Minimum number of Vault files required for SyncGuard protection to apply.":
        "SyncGuard による保護を適用するために必要な Vault 内の最小ファイル数です。",
    "Synchronisation protection": "同期保護",
    "Synchronising your Vault": "Vault を同期しています",
    "Receiving changes from the server…": "サーバーから変更を受信しています…",
    "Applying received changes to local notes…": "受信した変更をローカルノートに適用しています…",
    "Synchronisation was interrupted. You can continue locally, but some notes may be out of date.":
        "同期が中断されました。ローカルで作業を続けられますが、一部のノートは最新でない可能性があります。",
    "At least ${COUNT} changed files received": "変更されたファイルを少なくとも ${COUNT} 件受信しました",
    "Continue without waiting": "待たずに続行",
    "Hidden File Sync is disabled on this device. Enable it in Sync Settings before using Automatic or initialising hidden files.":
        "このデバイスでは非表示ファイル同期が無効です。Automatic を使用する場合や非表示ファイルを初期化する場合は、同期設定で有効にしてください。",
    "Hidden File Sync initialisation was not started.": "非表示ファイル同期は初期化されませんでした。",
    "Unknown platform": "不明なプラットフォーム",
    "This removes only this device's record from the remote.":
        "リモートから削除されるのは、このデバイスの記録のみです。",
    "This remote is unlocked. A device that returns can register again.":
        "このリモートのロックは解除されています。再接続したデバイスは再登録できます。",
    "This remote is locked. Use the existing recovery process for devices that need to join again.":
        "このリモートはロックされています。再参加が必要なデバイスには、既存の復旧手順を使用してください。",
    "This remote is locked. If the device returns, use the existing recovery process to join it again.":
        "このリモートはロックされています。デバイスが再接続した場合は、既存の復旧手順で再参加させてください。",
    "This remote does not support conditional updates, so the device record could not be removed.":
        "このリモートは条件付き更新に対応していないため、デバイスの記録を削除できませんでした。",
    "This remote does not currently have a record of joined devices.":
        "このリモートには参加済みデバイスの記録がありません。",
    "This list shows device information recorded by the remote. It does not show whether a device is online now.":
        "この一覧にはリモートに記録されたデバイス情報が表示されます。デバイスが現在オンラインかどうかは示しません。",
    "This device has been locked out. Use the existing recovery process to join again.":
        "このデバイスは接続を拒否されています。再参加するには、既存の復旧手順を使用してください。",
    "This device": "このデバイス",
    "This remote has been cleaned. Use the existing recovery process to join devices again as needed.":
        "このリモートはクリーンアップされました。必要に応じて、既存の復旧手順でデバイスを再参加させてください。",
    "The device record was forgotten.": "デバイスの記録を削除しました。",
    "The device record was already absent.": "デバイスの記録はすでにありません。",
    "The device list changed while you were trying to forget this device. Refresh the list before trying again.":
        "このデバイスの記録を削除しようとしている間に一覧が更新されました。もう一度試す前に一覧を再読み込みしてください。",
    "The device information could not be loaded. Close this dialogue and open Joined devices again if the remote configuration has changed.":
        "デバイス情報を読み込めませんでした。リモート設定を変更した場合は、このダイアログを閉じて「参加済みデバイス」を開き直してください。",
    "Review device records for the active CouchDB or Object Storage connection.":
        "アクティブな CouchDB またはオブジェクトストレージ接続のデバイス記録を確認します。",
    Refresh: "更新",
    "Plug-in version": "プラグインのバージョン",
    Platform: "プラットフォーム",
    "Older Self-hosted LiveSync versions detected: ${versions}.":
        "古いバージョンの Self-hosted LiveSync が検出されました: ${versions}。",
    "Newer Self-hosted LiveSync versions detected: ${versions}.":
        "新しいバージョンの Self-hosted LiveSync が検出されました: ${versions}。",
    "Reviewing and aligning Self-hosted LiveSync versions across devices is recommended.":
        "各デバイスの Self-hosted LiveSync のバージョンを確認し、揃えることをおすすめします。",
    Open: "開く",
    "Not recorded": "未記録",
    "Not accepted": "未承認",
    "No joined devices are recorded on this remote.": "このリモートには参加済みデバイスが記録されていません。",
    "Locked out": "接続拒否",
    "Loading joined devices…": "参加済みデバイスを読み込んでいます…",
    "Last recorded": "最終記録日時",
    "Joined devices could not be updated. Refresh the list and try again. If the remote configuration has changed, close this dialogue and open Joined devices again.":
        "参加済みデバイスを更新できませんでした。一覧を再読み込みしてもう一度お試しください。リモート設定を変更した場合は、このダイアログを閉じて「参加済みデバイス」を開き直してください。",
    "Joined devices are available after database startup with an active CouchDB or Object Storage connection.":
        "参加済みデバイスは、データベースの起動後に CouchDB またはオブジェクトストレージへの接続が有効になると表示されます。",
    "Joined devices": "参加済みデバイス",
    "Review devices": "デバイスを確認",
    "Synchronisation between different plug-in versions is generally safe unless the connection is explicitly blocked. However, it may be less efficient or use more storage, and P2P synchronisation may be unavailable.":
        "プラグインのバージョンが異なるデバイス間でも、接続が明示的にブロックされていなければ、通常は安全に同期できます。ただし、効率が低下したり、使用容量が増えたりする場合があります。また、P2P 同期を利用できないことがあります。",
    "Forgetting…": "記録を削除しています…",
    "Forgetting the record does not delete Vault files or revoke credentials.":
        "記録を削除しても、Vault 内のファイルは削除されず、認証情報も無効になりません。",
    "Forget this device record?": "このデバイスの記録を削除しますか？",
    "Forget device": "デバイスの記録を削除",
    Close: "閉じる",
    Cancel: "キャンセル",
    "App version": "アプリのバージョン",
    Accepted: "承認済み",
    "Preparing follow-up report…": "追加調査用レポートを準備しています…",
    "Cancelling local search. Checked ${COUNT} entries.":
        "ローカル検索をキャンセルしています。${COUNT}件を確認しました。",
    "Search current Vault paths and current local Metadata only. Older history and remote-only files are not searched.":
        "現在の Vault パスとローカルのメタデータのみを検索します。古い履歴やリモートにのみ存在するファイルは検索しません。",
    "The lookup does not read file contents or contact a remote database. Follow-up reports include current conflicts and merge bases.":
        "検索でファイルの内容を読み取ったり、リモートデータベースに接続したりすることはありません。追加調査用レポートには、現在の競合とマージベースが含まれます。",
    "Local file diagnostic report": "ローカルファイル診断レポート",
    "Checked ${COUNT} local entries.": "ローカルの項目を ${COUNT} 件確認しました。",
    "Enter a valid report path pseudonym.": "有効なレポート用パス仮名を入力してください。",
    "Search cancelled. Matches found so far are shown.":
        "検索をキャンセルしました。ここまでに見つかった一致項目を表示します。",
    "No matches were found in current Vault paths or current local Metadata. Older history and remote-only files are not searched.":
        "現在の Vault パスとローカルのメタデータに一致する項目はありません。古い履歴やリモートにのみ存在するファイルは検索していません。",
    "Found ${COUNT} local matches.": "ローカルで ${COUNT} 件見つかりました。",
    "The local search could not finish.": "ローカル検索を完了できませんでした。",
    "The file could not be opened.": "ファイルを開けませんでした。",
    "The follow-up report could not be prepared.": "追加調査用レポートを作成できませんでした。",
    "Report path pseudonym": "レポート用パス仮名",
    Source: "ソース",
    Metadata: "メタデータ",
    Vault: "Vault",
    "Metadata document ID": "メタデータドキュメント ID",
    "No current Metadata document": "現在のメタデータドキュメントなし",
    "Current Vault file": "現在の Vault ファイル",
    Present: "あり",
    Missing: "なし",
    "Open file": "ファイルを開く",
    "Prepare follow-up report": "追加調査用レポートを作成",
    "This report uses pseudonyms. Review its coverage before sharing.":
        "このレポートでは仮名を使用します。共有する前に、その対象範囲を確認してください。",
    "Back to matches": "検索結果に戻る",
    "Reading revisions": "リビジョンを読み込んでいます",
    "Calculating database usage": "データベース使用量を計算しています",
    "Discovering revisions": "リビジョンを確認しています",
    "Find a file from a report pseudonym": "レポート用の仮名からファイルを検索",
    "Find matching paths in this Vault and local Metadata, then prepare a follow-up report using the same pseudonyms.":
        "この Vault とローカルのメタデータから一致するパスを検索し、同じ仮名を使って追加調査用レポートを作成します。",
    "Find file": "ファイルを検索",
    "⚠️ Initialise or overwrite the remote": "⚠️ リモートを初期化または上書き",
    "🔗 Join this device": "🔗 このデバイスを参加させる",
    "⚙️ Apply settings only (advanced)": "⚙️ 設定のみ適用（高度な設定）",
    "Configure TURN when a direct connection cannot be established or when you select TURN relay only.":
        "直接接続を確立できない場合、または TURN リレーのみを選択する場合は、TURN を設定してください。",
    "TURN configuration": "TURN 設定",
    Manual: "手動",
    "Managed (Cloudflare)": "マネージド（Cloudflare）",
    "TURN Key ID": "TURN キー ID",
    "TURN Key API Token": "TURN キー API トークン",
    "Unsupported TURN configuration": "未対応の TURN 設定",
    "The API token is saved with this profile and included in Setup URI and QR code sharing. Temporary TURN credentials are kept in memory only.":
        "API トークンはこのプロファイルに保存され、セットアップ URI や QR コードでの共有にも含まれます。一時的な TURN 認証情報はメモリー上にのみ保持されます。",
    "TURN relay only requires a TURN server or a configured credential source under Advanced Settings.":
        "TURN リレーのみを使うには、TURN サーバーまたは高度な設定で認証情報の取得元を設定してください。",
    "Enter a TURN Key ID.": "TURN キー ID を入力してください。",
    "TURN Key ID contains unsupported characters.": "TURN キー ID に未対応の文字が含まれています。",
    "Enter a TURN Key API Token.": "TURN キー API トークンを入力してください。",
    "TURN Key API Token must use Bearer token syntax.":
        "TURN キー API トークンは Bearer トークン形式で入力してください。",
    "The selected TURN configuration is not supported.": "選択した TURN 設定には対応していません。",
    "Setup Complete: Preparing to Fetch from Another Device": "セットアップ完了: 別のデバイスから取得する準備中",
    "The P2P connection has been configured successfully. The initial synchronisation data must now be fetched from an online source device.":
        "P2P 接続を設定しました。初回の同期を行うため、オンラインのソースデバイスからデータを取得してください。",
    "After restarting, select an online source device for the initial Fetch. The local LiveSync database on this device will be rebuilt from that source. Unsynchronised files in this Vault may conflict with the fetched data.":
        "再起動後、初回取得のソースとなるオンラインデバイスを選択してください。このデバイスのローカル LiveSync データベースは、そのソースから再構築されます。この Vault で未同期のファイルは、取得したデータと競合する可能性があります。",
    "Restart this device, then choose the source device when P2P Rebuild opens.":
        "このデバイスを再起動してください。P2P 再構築が開いたら、ソースデバイスを選択します。",
    "Restart and Select Source Device": "再起動してソースデバイスを選択",
    "P2P Status pane": "P2P ステータスペイン",
    "No central data-storage server is required, but a signalling relay is required for peer discovery. Both devices must be online at the same time. Vault data travels through the encrypted P2P connection, not through the signalling relay. Some features may be limited.":
        "中央データストレージサーバーは不要ですが、ピアの検出にはシグナリングリレーが必要です。両方のデバイスが同時にオンラインである必要があります。Vault のデータは暗号化された P2P 接続を通り、シグナリングリレーを経由しません。一部の機能は制限される場合があります。",
    "P2P requires no central data-storage server, but it still uses a signalling relay for peer discovery.":
        "P2P には中央データストレージサーバーは不要ですが、ピアの検出にはシグナリングリレーを使用します。",
    "Signalling relay URLs": "シグナリングリレー URL",
    "Peer discovery uses Nostr-compatible signalling relays.":
        "ピアの検出には Nostr 互換のシグナリングリレーを使用します。",
    "Use the project's public signalling relay": "プロジェクトの公開シグナリングリレーを使用",
    "The project's public signalling relay is a best-effort convenience operated by the project author. It does not store Vault contents, but signalling metadata may be visible to the relay. Availability and log retention are not guaranteed. You can replace it with your own Nostr-compatible relay.":
        "プロジェクトの公開シグナリングリレーは、プロジェクト作者が便宜上、可能な範囲で運用しています。Vault の内容は保存されませんが、シグナリングのメタデータはリレーから見える場合があります。稼働状況やログの保存期間は保証されません。独自の Nostr 互換リレーに変更できます。",
    "Learn more about P2P connections": "P2P 接続について詳しく見る",
    "Learn more about signalling and TURN": "シグナリングと TURN について詳しく見る",
    "WebRTC encrypts data between your devices, including when it passes through TURN. The TURN provider cannot read the transferred data. It can see network addresses and traffic volume.":
        "TURN を経由する場合も含め、WebRTC はデバイス間のデータを暗号化します。TURN プロバイダーは転送データを読み取れませんが、ネットワークアドレスと通信量を確認できます。",
    "Connection compatibility": "接続互換性",
    "P2P message size": "P2P メッセージサイズ",
    Standard: "標準",
    Reduced: "縮小",
    Conservative: "保守的",
    "Maximum compatibility": "互換性を最大化",
    "Smaller messages can improve compatibility on paths which fragment or drop larger WebRTC messages. This setting limits outgoing P2P messages, so use a compatible profile on each sending device when required.":
        "メッセージを小さくすると、大きな WebRTC メッセージが分割または破棄される経路で互換性が向上する場合があります。この設定は送信する P2P メッセージのサイズを制限します。必要に応じて、送信側の各デバイスで互換性のあるプロファイルを選択してください。",
    "Connection path": "接続経路",
    "TURN relay only": "TURN リレーのみ",
    "TURN relay only is available when at least one valid TURN server URL is configured under Advanced Settings.":
        "高度な設定で有効な TURN サーバー URL を1つ以上設定すると、TURN リレーのみを選択できます。",
    "TURN relay only requires at least one valid TURN server URL. Connection path has been restored to Automatic.":
        "TURN リレーのみを使うには、有効な TURN サーバー URL が1つ以上必要です。接続経路を自動に戻しました。",
    "Announce changes": "変更を通知",
    "Announce changes automatically after connecting": "接続後に変更を自動通知",
    "When enabled, this device notifies connected peers after a local change. The notification contains no Vault data; a peer which follows this device then fetches the change through the encrypted P2P connection.":
        "有効にすると、ローカルで変更があったときに接続中のピアへ通知します。通知に Vault のデータは含まれません。このデバイスの変更を受け取る設定のピアは、暗号化された P2P 接続を通じて変更を取得します。",
    "Stop announcing changes": "変更の通知を停止",
    "Start announcing changes": "変更の通知を開始",
    "Follow changes": "変更を受け取る",
    "Stop following changes from this device": "このデバイスからの変更受信を停止",
    "Follow changes from this device": "このデバイスからの変更を受信",
    "Synchronise when this device connects": "このデバイスの接続時に同期",
    "Follow whenever this device connects": "このデバイスが接続するたびに変更を受信",
    "Include in the P2P synchronisation command": "P2P 同期コマンドに含める",
    "More actions for ${DEVICE}": "${DEVICE} のその他の操作",
    "Use this device's settings": "このデバイスの設定を使用",
    Retry: "再試行",
    "No Synchronisation Settings Found": "同期設定が見つかりません",
    "The selected remote has no saved synchronisation settings. This is normal for a new remote. Use this device's settings, or cancel if you expected existing settings.":
        "選択したリモートには保存済みの同期設定がありません。新しいリモートでは通常の状態です。このデバイスの設定を使用してください。既存の設定があるはずの場合はキャンセルしてください。",
    "Could Not Read Synchronisation Settings": "同期設定を読み取れませんでした",
    "Could not read the remote's synchronisation settings. Check the connection and credentials, then retry.":
        "リモートの同期設定を読み取れませんでした。接続と認証情報を確認してから、もう一度お試しください。",
    "Could not read the remote's synchronisation settings. Retry, or continue the overwrite with this device's settings. A working connection is still required.":
        "リモートの同期設定を読み取れませんでした。再試行するか、このデバイスの設定で上書きを続行してください。続行する場合も、接続が機能している必要があります。",
    "Skips checking and applying synchronisation settings from the remote.":
        "リモートの同期設定の確認と適用をスキップします。",
    "Change CouchDB server setting": "CouchDB サーバー設定を変更",
    "Change CouchDB server setting '${SETTING}' to '${VALUE}'?":
        "CouchDB サーバー設定「${SETTING}」を「${VALUE}」に変更しますか？",
    "TURN relay only requires TURN configuration. Connection path has been restored to Automatic.":
        "TURN リレーのみを使うには TURN の設定が必要です。接続経路を自動に戻しました。",
    "This file has unresolved conflicts.": "このファイルには未解決の競合があります。",
    "This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.":
        "このファイルには未解決の版が ${COUNT} 件あります。1組ずつ確認します。",
    "Sync now": "今すぐ同期",
    "Apply pending changes now": "保留中の変更を今すぐ適用",
    "Copy database information for the active file": "アクティブなファイルのデータベース情報をコピー",
    "Copy database information for a file": "ファイルのデータベース情報をコピー",
    "Copy revision, conflict, and local chunk availability information, including document and chunk identifiers but not file contents.":
        "ファイルの内容を含めずに、ドキュメント ID やチャンク ID などのリビジョン、競合、ローカルのチャンク有無に関する情報をコピーします。",
    "Choose file": "ファイルを選択",
    "Choose a file to inspect": "確認するファイルを選択",
    "Database information for ${FILE}": "${FILE} のデータベース情報",
    "All revisions and chunk availability below are a snapshot of this device's local database; the remote is not queried. Review the Vault-relative path, document identifier, content-derived chunk identifiers, and metadata before sharing this report. File contents are omitted.":
        "以下のリビジョンとチャンク有無は、このデバイスのローカルデータベースのスナップショットです。リモートには問い合わせません。このレポートを共有する前に、Vault からの相対パス、ドキュメント ID、コンテンツ由来のチャンク ID、メタデータを確認してください。ファイルの内容は含まれません。",
    "📁 Vault: ${SIZE} B · ${TIME}": "📁 Vault: ${SIZE} B · ${TIME}",
    "📁 Vault: missing": "📁 Vault: ファイルなし",
    "🗄️ Local DB: missing": "🗄️ ローカル DB: データなし",
    "Vault and database revision": "Vault とデータベースのリビジョン",
    "Vault file": "Vault ファイル",
    "Database revision": "データベースのリビジョン",
    "Vault file is newer": "Vault ファイルの方が新しい",
    "Database revision is newer": "データベースのリビジョンの方が新しい",
    "Within the two-second comparison window": "2秒以内の誤差範囲内",
    "Timestamp comparison unavailable": "タイムスタンプを比較できません",
    "${ROLE}: ${REVISION}": "${ROLE}: ${REVISION}",
    "Winner revision": "代表リビジョン",
    "Conflict revision": "競合リビジョン",
    "Unknown revision": "不明なリビジョン",
    "🗑️ Logical deletion": "🗑️ 論理削除",
    "Readable on this device; recorded size ${RECORDED}, decoded size ${ACTUAL}":
        "このデバイスで読み取り可能。記録サイズ ${RECORDED}、デコード後サイズ ${ACTUAL}",
    "🧩 Missing chunks: ${COUNT}": "🧩 チャンク不足: ${COUNT} 件",
    "📦 DB: recorded ${RECORDED} B · decoded ${DECODED} B · Δsize ${DIFFERENCE} B":
        "📦 DB: 記録 ${RECORDED} B · デコード後 ${DECODED} B · サイズ差 ${DIFFERENCE} B",
    "📦 DB: recorded ${RECORDED} B · decoded unavailable": "📦 DB: 記録 ${RECORDED} B · デコード後サイズは不明",
    "📁 Vault: ${VAULT} B · Δsize vs DB ${DIFFERENCE} B": "📁 Vault: ${VAULT} B · DB とのサイズ差 ${DIFFERENCE} B",
    "🕒 DB ${DATABASE_TIME} · Vault ${VAULT_TIME} · Δtime ${DIFFERENCE} ms (${RELATION})":
        "🕒 DB ${DATABASE_TIME} · Vault ${VAULT_TIME} · 時刻差 ${DIFFERENCE} ms（${RELATION}）",
    "✅ Matches Vault": "✅ Vault と一致",
    "⚠️ Differs from Vault": "⚠️ Vault と不一致",
    "✅ Vault matches winner": "✅ Vault は代表リビジョンと一致",
    "⚠️ Conflicts: ${COUNT}": "⚠️ 競合: ${COUNT} 件",
    "Compare with Vault": "Vault と比較",
    "Apply this revision to Vault": "このリビジョンを Vault に適用",
    "Apply database revision ${REVISION} to ${FILE}? The current Vault file will be overwritten.":
        "データベースのリビジョン ${REVISION} を ${FILE} に適用しますか？現在の Vault ファイルは上書きされます。",
    "Apply database revision to Vault": "データベースのリビジョンを Vault に適用",
    "Mark this revision as the Vault version": "このリビジョンを Vault の版として指定",
    "Store Vault file as a child of this revision": "Vault ファイルをこのリビジョンの子として保存",
    "Apply logical deletion to Vault": "論理削除を Vault に適用",
    "Apply logical deletion ${REVISION} to ${FILE}? The current Vault file will be removed.":
        "論理削除 ${REVISION} を ${FILE} に適用しますか？現在の Vault ファイルは削除されます。",
    "Retry reading revision": "リビジョンの読み込みを再試行",
    "Discard this branch": "このブランチを破棄",
    "Discard branch": "ブランチを破棄",
    "Discard database branch ${REVISION} of ${FILE}? This creates a logical deletion for that exact live branch. The current Vault file will not be changed.":
        "${FILE} のデータベースブランチ ${REVISION} を破棄しますか？この操作は該当する現行ブランチに論理削除を記録します。現在の Vault ファイルは変更されません。",
    "Discard unreadable revision": "読み取れないリビジョンを破棄",
    "Discard database revision ${REVISION} of ${FILE}? This creates a logical deletion for that exact live revision. Missing content cannot be recovered by this action.":
        "${FILE} のデータベースリビジョン ${REVISION} を破棄しますか？この操作は該当する現行リビジョンに論理削除を記録します。不足している内容はこの操作では復元できません。",
    "Revision metadata is unavailable on this device": "このデバイスではリビジョンのメタデータを利用できません",
    "Shared ancestor ${REVISION} is not readable on this device. Automatic three-way merging may be unavailable, but the live revisions remain available for explicit review.":
        "共有祖先 ${REVISION} はこのデバイスで読み取れません。自動3方向マージを利用できない場合がありますが、現行リビジョンは引き続き個別に確認できます。",
    "No shared ancestor is available for this conflict. The live revisions remain available for explicit review.":
        "この競合には共有祖先がありません。現行リビジョンは引き続き個別に確認できます。",
    "More actions for revision ${REVISION}": "リビジョン ${REVISION} のその他の操作",
    "More actions for ${FILE}": "${FILE} のその他の操作",
    "Show revision history": "リビジョン履歴を表示",
    "Store Vault file as a new local database document":
        "Vault ファイルを新しいローカルデータベースドキュメントとして保存",
    "Copy database information": "データベース情報をコピー",
    "Recreate chunks for current Vault files": "現在の Vault ファイルのチャンクを再作成",
    "Recreate chunks from the files currently present in this Vault. This cannot reconstruct unavailable historical or conflict content.":
        "この Vault に現在あるファイルからチャンクを再作成します。利用できない過去の内容や競合内容は復元できません。",
    "Recreate current chunks": "現在のチャンクを再作成",
    "Resolve every conflict by modification time? This logically deletes every version except the newest one and cannot recover content which is already unavailable.":
        "すべての競合を更新日時で解決しますか？最も新しい版以外はすべて論理削除され、すでに利用できない内容は復元できません。",
    "Resolve all conflicts by the newest version": "すべての競合を最も新しい版で解決",
    "Inspect conflicts and file/database differences": "競合とファイル／データベース間の差異を調査",
    "Scan Vault files and local-database Metadata for conflicts, missing chunks, identity mismatches, and differences. Each result provides actions for one exact entry or revision.":
        "Vault ファイルとローカルデータベースのメタデータをスキャンし、競合、チャンク不足、識別情報の不一致、差異を確認します。各結果から、該当する項目またはリビジョンに対する操作を選択できます。",
    "Begin inspection": "調査を開始",
    "Metadata entry requires review and was left unchanged": "確認が必要なメタデータ項目は変更せずに残しました",
    "The stored document ID does not match the ID derived from its recorded path.":
        "保存されたドキュメント ID が、記録されたパスから導出される ID と一致しません。",
    "The stored document ID and recorded path are handled by different synchronisation features.":
        "保存されたドキュメント ID と記録されたパスは、それぞれ異なる同期機能によって処理されます。",
    "Stored document ID: ${ID}": "保存されたドキュメント ID: ${ID}",
    "Expected document ID: ${ID}": "期待されるドキュメント ID: ${ID}",
    "Source revision: ${REVISION}": "ソースリビジョン: ${REVISION}",
    "One-step repair is unavailable because this entry is ambiguous, no longer current, or unsafe to change.":
        "この項目は情報があいまいであるか、最新ではないか、または変更が安全ではないため、ワンステップ修復は利用できません。",
    "An exact target is already present; repair can remove the obsolete ID.":
        "同一の対象がすでに存在するため、修復時に古い ID を削除できます。",
    "Repair is available for this entry.": "この項目は修復できます。",
    "Repair this Metadata document ID": "このメタデータドキュメント ID を修復",
    "Repair Metadata ID": "メタデータ ID を修復",
    "Keep unchanged": "変更せずに保持",
    "This moves one local Metadata entry to the ID derived from its recorded path.\n\n**File:** `${FILE}`  \n**Source:** `${SOURCE}@${REVISION}`  \n**Target:** `${TARGET}`\n\nThe target is verified before the source is removed. Its CouchDB revision ancestry cannot be preserved.\n\n> [!warning] Before repairing\n> - Back up this device.\n> - If file-name case or path obfuscation was intentionally changed for the whole database, use Rebuild instead.\n> - If other devices share this database, pause them, allow this device to upload the repair, then resume them one at a time.":
        "ローカルのメタデータ項目を、記録されたパスから導出される ID に移動します。\n\n**ファイル:** `${FILE}`  \n**移動元:** `${SOURCE}@${REVISION}`  \n**移動先:** `${TARGET}`\n\n移動元を削除する前に、移動先を検証します。CouchDB のリビジョン祖先は保持できません。\n\n> [!warning] 修復する前に\n> - このデバイスをバックアップしてください。\n> - データベース全体のファイル名の大文字・小文字の扱いやパス難読化を意図的に変更した場合は、代わりに再構築してください。\n> - 他のデバイスがこのデータベースを共有している場合は、それらを一時停止し、このデバイスから修復内容がアップロードされた後、1台ずつ再開してください。",
    "Metadata document ID repair and the ordinary Vault scan completed. Run this inspection again after synchronisation.":
        "メタデータドキュメント ID の修復と通常の Vault スキャンが完了しました。同期後にこの調査を再実行してください。",
    "Metadata document ID repair completed, but the ordinary Vault scan did not run. Keep synchronisation paused, resolve the scan condition, then run 'Scan storage and database again'.":
        "メタデータドキュメント ID の修復は完了しましたが、通常の Vault スキャンは実行されませんでした。同期を一時停止したままスキャンを妨げている状態を解消し、「ストレージとデータベースを再スキャン」を実行してください。",
    "The inspected state changed. No repair was performed; run inspection again.":
        "調査対象の状態が変化しました。修復は行われていません。調査を再実行してください。",
    "Repair stopped after creating the target. The source was retained. Run inspection again before retrying.":
        "移動先を作成した後、修復を停止しました。移動元は保持されています。再試行する前に調査を実行してください。",
    "Repair failed before the source was removed. Run inspection again before retrying.":
        "移動元を削除する前に修復が失敗しました。再試行する前に調査を実行してください。",
    "(RegExp) Limit normal files to matching paths. Leave empty to allow all normal file paths. Hidden File Sync uses its own target patterns.":
        "（正規表現）通常ファイルを一致するパスに限定します。空欄にすると、すべての通常ファイルパスが対象になります。非表示ファイル同期には専用の対象パターンを使用します。",
    "(RegExp) Skip changes to matching normal and hidden files, locally and remotely.":
        "（正規表現）一致する通常ファイルと非表示ファイルの変更を、ローカルとリモートの両方でスキップします。",
    "Repair Metadata document ID": "メタデータドキュメント ID を修復",
    "Connection settings": "接続設定",
    "Saved connections": "保存済みの接続",
    "ID generation": "ID の生成",
    "Keep current configuration": "現在の設定を維持",
    "Set an ID key": "ID キーを設定",
    "Current configuration: a saved ID key is used.": "現在の設定: 保存済みの ID キーを使用します。",
    "Current configuration: the saved ID key is retained while E2EE is off.":
        "現在の設定: E2EE が無効な間も保存済みの ID キーを保持します。",
    "Current configuration: no ID key is saved. With E2EE enabled, keeping it uses legacy IDs tied to the E2EE passphrase.":
        "現在の設定: ID キーは保存されていません。E2EE が有効な場合、現在の設定を維持すると E2EE パスフレーズに紐づく旧形式の ID を使用します。",
    "Changing the E2EE passphrase changes IDs generated by the legacy configuration.":
        "旧形式の設定では、E2EE パスフレーズを変更すると生成される ID も変わります。",
    "This uses a saved key for new Chunk IDs and obfuscated Metadata document IDs, so changing the E2EE passphrase does not derive a new key automatically.":
        "新しいチャンク ID と難読化されたメタデータドキュメント ID に保存済みのキーを使います。そのため、E2EE パスフレーズを変更しても新しいキーは自動導出されません。",
    Configured: "設定済み",
    "The saved ID key is configured. Its source cannot be shown again.":
        "保存済みの ID キーが設定されています。キーの導出元を再表示することはできません。",
    "Leave this input empty to keep the saved ID key.":
        "保存済みの ID キーを維持するには、この欄を空のままにしてください。",
    "Generate a random ID key": "ランダムな ID キーを生成",
    "How to set the ID key": "ID キーの設定方法",
    "Derive from current E2EE passphrase": "現在の E2EE パスフレーズから導出",
    "Enter an ID source": "ID の導出元を入力",
    "Import an ID recovery code": "ID 復旧コードをインポート",
    "ID source": "ID の導出元",
    "ID recovery code": "ID 復旧コード",
    "Enter an ID recovery code": "ID 復旧コードを入力",
    "Choose a long, unpredictable source. It is used once and cannot be shown again after saving. A recovery code can be displayed on this device later. This input also accepts a tagged recovery code.":
        "長く推測されにくい導出元を指定してください。導出元は一度だけ使用され、保存後は再表示できません。復旧コードは後からこのデバイスで表示できます。この入力欄にはタグ付き復旧コードも指定できます。",
    "Paste a tagged recovery code from an existing device to restore the same ID key.":
        "既存のデバイスからタグ付き復旧コードを貼り付けると、同じ ID キーを復元できます。",
    "For recovery after losing every device, save the recovery code after setup or choose an ID source you can reproduce.":
        "すべてのデバイスを失った場合に備え、セットアップ後に復旧コードを保存するか、再現可能な ID の導出元を選んでください。",
    "Show current recovery code": "現在の復旧コードを表示",
    "Hide current recovery code": "現在の復旧コードを隠す",
    "Current ID recovery code": "現在の ID 復旧コード",
    "Copy recovery code": "復旧コードをコピー",
    "Recovery code copied.": "復旧コードをコピーしました。",
    "The displayed recovery code belongs to the current key. Reopen this dialogue after saving to copy the replacement key.":
        "表示中の復旧コードは現在のキーに対応しています。キーを置き換えた場合は、保存後にこのダイアログを開き直して新しい復旧コードをコピーしてください。",
    "The recovery code could not be copied. Select and copy the visible code instead.":
        "復旧コードをコピーできませんでした。表示されているコードを選択してコピーしてください。",
    "The ID key is derived from the current E2EE passphrase and saved separately. Changing that passphrase later does not change the saved ID key. To reduce the risk of guessing that passphrase from known IDs, use a separate, unpredictable ID source instead.":
        "ID キーは現在の E2EE パスフレーズから導出され、別に保存されます。後からパスフレーズを変更しても、保存済みの ID キーは変わりません。既知の ID からパスフレーズを推測されるリスクを下げるには、別の推測されにくい ID の導出元を使用してください。",
    "An ID source is required to enable this option.": "このオプションを有効にするには、ID の導出元が必要です。",
    "The ID source or recovery code is invalid. Check it and try again.":
        "ID の導出元または復旧コードが無効です。確認してもう一度お試しください。",
    "Read normal-file Metadata and current conflicts locally and in CouchDB, then compare content for suspect groups. Choose original names or pseudonyms before starting.":
        "ローカルと CouchDB の通常ファイルのメタデータおよび現在の競合を読み取り、問題が疑われる項目の内容を比較します。開始前に、元の名前を使うか仮名を使うか選択してください。",
    Inspect: "調査",
    "Inspect database integrity": "データベースの整合性を調査",
    "Inspection completed. Review the findings and coverage before sharing.":
        "調査が完了しました。共有する前に結果と調査範囲を確認してください。",
    "Inspection partially completed. Some information could not be checked; review the reported reasons.":
        "調査は一部のみ完了しました。確認できなかった情報があります。表示された理由を確認してください。",
    "Inspection failed. The report records the available evidence and reasons.":
        "調査に失敗しました。レポートには、取得できた証拠と失敗理由が記録されています。",
    "Inspection cancelled. The report contains only the evidence collected so far.":
        "調査をキャンセルしました。レポートには、ここまでに収集した証拠のみが含まれます。",
    "Report copied.": "レポートをコピーしました。",
    "Copy failed. Select the report text and copy it manually.":
        "コピーに失敗しました。レポートのテキストを選択して手動でコピーしてください。",
    "Download requested. You can also copy the report if downloads are unavailable on this device.":
        "ダウンロードを要求しました。このデバイスでダウンロードできない場合は、レポートをコピーすることもできます。",
    "Pseudonyms include a public salt, so guessed paths can be checked. Original names include private filenames. Reports omit file contents and credentials.":
        "仮名には公開ソルトが含まれるため、推測したパスと照合できます。元の名前を選ぶと、非公開のファイル名が含まれます。どちらのレポートにもファイルの内容や認証情報は含まれません。",
    "Read available local revisions and report their Chunk references. Settings are left unchanged.":
        "利用可能なローカルリビジョンを読み取り、参照するチャンクをレポートします。設定は変更されません。",
    "Inspect normal-file Metadata, current conflicts, and suspect content against the Vault. Remote inspection supports CouchDB. Older history is excluded; findings do not authorise deletion.":
        "通常ファイルのメタデータ、現在の競合、問題が疑われる内容を Vault と照合します。リモートの調査は CouchDB に対応しています。古い履歴は対象外です。調査結果を根拠に削除が実行されることはありません。",
    "Include remote database": "リモートデータベースを含める",
    "Names in this report": "レポート内の名前",
    "Pseudonyms (recommended)": "仮名（推奨）",
    "Original names": "元の名前",
    "Cancelling inspection…": "調査をキャンセルしています…",
    "Items inspected": "調査した項目数",
    "Cancel inspection": "調査をキャンセル",
    "This report uses temporary pseudonyms. Counts and relationships remain visible.":
        "このレポートでは一時的な仮名を使用します。件数や項目間の関係は表示されます。",
    "This report contains original paths and identifiers. Review them before sharing.":
        "このレポートには元のパスと識別子が含まれます。共有する前に内容を確認してください。",
    "Partial Usage results are available as JSON so their coverage and reasons stay with the rows.":
        "一部のみ取得できた使用状況の結果は JSON で出力できます。各行に調査範囲と理由が保持されます。",
    "Report format": "レポート形式",
    "Diagnostic report": "診断レポート",
    "Copy report": "レポートをコピー",
    "Save report": "レポートを保存",
    "The inspection could not finish. Close this dialogue and try again after database startup.":
        "調査を完了できませんでした。このダイアログを閉じ、データベースの起動後にもう一度お試しください。",
    "Resume scheduled fetch?": "予約済みの取得を再開しますか？",
    "Apply these saved choices to the current remote?\n\nCurrent remote: ${REMOTE}\n\n- ${STAGE1}\n- ${STAGE2}\n\nThe fetch flag may remain after an interruption or an incomplete cleanup. Continue only if this fetch is still intended.":
        "保存済みの選択肢を現在のリモートに適用しますか？\n\n現在のリモート: ${REMOTE}\n\n- ${STAGE1}\n- ${STAGE2}\n\n中断や不完全なクリーンアップの後に取得フラグが残っている可能性があります。この取得を実行する意図がある場合にのみ続行してください。",
    "Continue with these choices": "この選択肢で続行",
    "Choose again": "選び直す",
    "Saved fetch choices could not be read": "保存済みの取得設定を読み取れませんでした",
    "The fetch flag does not contain one supported selection. Choose new options and continue with the current remote?\n\nCurrent remote: ${REMOTE}\n\nThe flag contents will remain unchanged. The new choices apply only to this attempt; another restart will ask again. Completing or cancelling the fetch removes the flag.":
        "取得フラグに有効な選択肢が含まれていません。新しい選択肢を指定して、現在のリモートで続行しますか？\n\n現在のリモート: ${REMOTE}\n\nフラグの内容は変更されません。新しい選択肢は今回の試行にのみ適用され、再起動すると再度確認されます。取得を完了またはキャンセルすると、フラグは削除されます。",
    "Choose new options and continue": "新しい選択肢を指定して続行",
    "Batch database updates in LiveSync mode": "LiveSync モードでデータベース更新をバッチ処理",
    "Wait for a bounded local quiet period before processing file updates in LiveSync mode, reducing intermediate database updates while delaying their reflection to remote devices.":
        "LiveSync モードでは、ローカルでの更新が一定時間落ち着くまで待ってからファイル更新を処理します。これにより中間のデータベース更新を減らし、リモートデバイスへの反映を遅らせます。",
    Apply: "適用",
    Add: "追加",
    Revert: "元に戻す",
    "Vault history": "Vault 履歴",
    "From:": "開始:",
    "To:": "終了:",
    "Info:": "情報:",
    "To stop the countdown, tap anywhere on the dialogue":
        "カウントダウンを停止するには、ダイアログの任意の場所をタップしてください",
};
