/**
 * Canonical English for LiveSync-owned messages whose wording is still being
 * exercised. These keys remain application-owned and must not be added to
 * Commonlib merely to make them available to the LiveSync translator.
 *
 * Move a message to the YAML catalogue when it is ready for translation, and
 * remove it from this map in the same change.
 */
export const liveSyncProvisionalEnglishMessages = {
    "This first setup has several short steps because it confirms encryption, the connection method, and which device provides the initial data. Once it is complete, additional devices can reuse a Setup URI.":
        "This first setup has several short steps because it confirms encryption, the connection method, and which device provides the initial data. Once it is complete, additional devices can reuse a Setup URI.",
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
    "TURN relays the encrypted WebRTC connection only when a direct path cannot be established. A TURN provider cannot read encrypted Vault contents, but it can observe connection metadata and traffic volume. Use a provider you trust.":
        "TURN relays the encrypted WebRTC connection only when a direct path cannot be established. A TURN provider cannot read encrypted Vault contents, but it can observe connection metadata and traffic volume. Use a provider you trust.",
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
    "Create or connect to database and continue": "Create or connect to database and continue",
    "Connect to existing database and continue": "Connect to existing database and continue",
    "Test connection and save": "Test connection and save",
    "Save without connecting": "Save without connecting",
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
    "Enter a complete HTTP or HTTPS URL.": "Enter a complete HTTP or HTTPS URL.",
    "CouchDB validates the database name when you connect. The name must not be empty.":
        "CouchDB validates the database name when you connect. The name must not be empty.",
    "Saving without a successful connection test keeps this profile, but automatic synchronisation may fail until the connection is corrected.":
        "Saving without a successful connection test keeps this profile, but automatic synchronisation may fail until the connection is corrected.",
    "This optional check uses Obsidian's internal request API and sends the credentials above to the CouchDB server. Use it only with a server you trust; administrator access may be required.":
        "This optional check uses Obsidian's internal request API and sends the credentials above to the CouchDB server. Use it only with a server you trust; administrator access may be required.",
    "Check server requirements": "Check server requirements",
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
} as const;

export type LiveSyncProvisionalMessageKey = keyof typeof liveSyncProvisionalEnglishMessages;
