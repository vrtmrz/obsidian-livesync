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
    "WebDAV Journal Configuration": "WebDAV Journal Configuration",
    "Configure a dedicated WebDAV collection for Journal synchronisation. Opaque Journal needs ordinary WebDAV access. Adaptive Journal additionally runs an endpoint safety check before the profile is accepted.":
        "Configure a dedicated WebDAV collection for Journal synchronisation. Opaque Journal needs ordinary WebDAV access. Adaptive Journal additionally runs an endpoint safety check before the profile is accepted.",
    "Collection prefix": "Collection prefix",
    "Use a dedicated prefix. WebDAV listing scans the collection, so unrelated files and a long Journal history increase discovery work.":
        "Use a dedicated prefix. WebDAV listing scans the collection, so unrelated files and a long Journal history increase discovery work.",
    "Enable this when browser-compatible requests are blocked by CORS. It uses Obsidian's internal request API and may behave differently from standard browser fetch.":
        "Enable this when browser-compatible requests are blocked by CORS. It uses Obsidian's internal request API and may behave differently from standard browser fetch.",
    "Enter a complete HTTP or HTTPS endpoint without a query string or fragment.":
        "Enter a complete HTTP or HTTPS endpoint without a query string or fragment.",
    "Use HTTP Range requests": "Use HTTP Range requests",
    "Complete Pack reads favour throughput and are the portable default. Range reads can reduce transferred bytes, but this endpoint must pass the exact byte-range check.":
        "Complete Pack reads favour throughput and are the portable default. Range reads can reduce transferred bytes, but this endpoint must pass the exact byte-range check.",
    "The Adaptive safety check writes, reads, lists, and removes disposable objects under a random probe prefix. It does not inspect Vault data.":
        "The Adaptive safety check writes, reads, lists, and removes disposable objects under a random probe prefix. It does not inspect Vault data.",
    "Required Adaptive operations are supported by this WebDAV endpoint.":
        "Required Adaptive operations are supported by this WebDAV endpoint.",
    "The WebDAV endpoint is missing required Adaptive operations: ${CAPABILITIES}.":
        "The WebDAV endpoint is missing required Adaptive operations: ${CAPABILITIES}.",
    "The Adaptive safety check failed (${CATEGORY}; retry ${RETRY}).":
        "The Adaptive safety check failed (${CATEGORY}; retry ${RETRY}).",
    "Required Adaptive operations were not checked.": "Required Adaptive operations were not checked.",
    "Exact HTTP byte-range retrieval is supported.": "Exact HTTP byte-range retrieval is supported.",
    "HTTP byte-range retrieval is not supported. Complete Pack retrieval remains available.":
        "HTTP byte-range retrieval is not supported. Complete Pack retrieval remains available.",
    "HTTP byte-range retrieval was not checked because the required safety check did not complete.":
        "HTTP byte-range retrieval was not checked because the required safety check did not complete.",
    "The selected WebDAV Journal policy is not supported by this endpoint.":
        "The selected WebDAV Journal policy is not supported by this endpoint.",
    "The remote contains ${REMOTE_FORMAT} data, but this profile selects ${SELECTED_FORMAT}. Rebuild the remote or restore the matching format.":
        "The remote contains ${REMOTE_FORMAT} data, but this profile selects ${SELECTED_FORMAT}. Rebuild the remote or restore the matching format.",
    "This build cannot inspect WebDAV Journal capabilities.": "This build cannot inspect WebDAV Journal capabilities.",
    "Invalid WebDAV settings: ${REASON}": "Invalid WebDAV settings: ${REASON}",
    "The saved connection contains credentials and custom headers. Configuration encryption protects exported Setup data when it is enabled; do not share a plain connection string.":
        "The saved connection contains credentials and custom headers. Configuration encryption protects exported Setup data when it is enabled; do not share a plain connection string.",
    "WebDAV Journal": "WebDAV Journal",
    "Store Journal data in a dedicated WebDAV collection. Adaptive mode is experimental and requires an endpoint safety check.":
        "Store Journal data in a dedicated WebDAV collection. Adaptive mode is experimental and requires an endpoint safety check.",
    "Continue to WebDAV setup": "Continue to WebDAV setup",
    "Expected repository ID": "Expected repository ID",
    "This optional identity pins a trusted Adaptive repository. A Setup URI can supply it; leave it blank only when creating a repository or intentionally trusting the first compatible repository reached.":
        "This optional identity pins a trusted Adaptive repository. A Setup URI can supply it; leave it blank only when creating a repository or intentionally trusting the first compatible repository reached.",
    "Run endpoint safety check": "Run endpoint safety check",
    "Test WebDAV connection": "Test WebDAV connection",
    "Continue with verified settings": "Continue with verified settings",
    "Save verified settings": "Save verified settings",
    "WebDAV access and the selected Journal format were verified.":
        "WebDAV access and the selected Journal format were verified.",
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
    "Scan every Vault file and live local-database revision for conflicts, missing chunks, and differences. Each result provides actions for the exact revision.":
        "Scan every Vault file and live local-database revision for conflicts, missing chunks, and differences. Each result provides actions for the exact revision.",
    "Begin inspection": "Begin inspection",
    "Connection settings": "Connection settings",
    "Saved connections": "Saved connections",
} as const;

export type LiveSyncProvisionalMessageKey = keyof typeof liveSyncProvisionalEnglishMessages;
