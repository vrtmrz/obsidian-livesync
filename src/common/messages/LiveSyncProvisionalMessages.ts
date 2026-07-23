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
    "Setup Complete: Preparing to Fetch from Another Device":
        "Setup Complete: Preparing to Fetch from Another Device",
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
} as const;

export type LiveSyncProvisionalMessageKey = keyof typeof liveSyncProvisionalEnglishMessages;
