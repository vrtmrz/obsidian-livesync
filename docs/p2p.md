# How peer-to-peer synchronisation works

Peer-to-peer (P2P) synchronisation transfers Vault data between LiveSync devices through WebRTC. It does not require a central database containing a copy of the Vault. It does require a signalling relay so that devices can discover one another and establish a connection.

For the procedure for the first and additional devices, see [Set up peer-to-peer synchronisation](setup_p2p.md). For connection problems, see [Peer-to-Peer Synchronisation Tips](tips/p2p-sync-tips.md).

## Connection model

```mermaid
flowchart LR
    A["Device A"] <-->|"Discovery and connection signalling"| S["Signalling relay"]
    S <-->|"Discovery and connection signalling"| B["Device B"]
    A <-->|"Encrypted Vault synchronisation"| B
    A -.->|"Fallback encrypted WebRTC traffic"| T["TURN server"]
    T -.-> B
```

The signalling relay and TURN server have different roles:

- The **signalling relay** is required for peer discovery and connection negotiation. LiveSync uses Nostr-compatible WebSocket relays for this role. The relay does not store or transfer Vault contents.
- A **TURN server** is an optional fallback. WebRTC uses it to relay the encrypted peer connection when the devices cannot establish a direct path through their networks, or whenever **TURN relay only** is selected.

## The project's public signalling relay

The project author operates a public signalling relay as a best-effort convenience. Selecting **Use the project's public signalling relay** means that no signalling server needs to be provisioned for an ordinary setup.

The public relay:

- is not a Vault storage service;
- may observe signalling metadata, such as connection timing and network addresses;
- has no availability or log-retention guarantee; and
- can be replaced with another compatible relay at any time by updating every device in the P2P group.

Use a signalling relay which is acceptable for your privacy and availability requirements. A controlled deployment may use its own Nostr-compatible relay.

## Signalling relay and TURN server

Both settings contain server addresses, but they are not interchangeable.

| Setting | Required | Carries Vault contents | Purpose |
| --- | --- | --- | --- |
| **Signalling relay URLs** | Yes | No | Finds peers and exchanges the information needed to establish WebRTC connections. |
| **TURN server URLs** | When direct WebRTC connectivity fails or **TURN relay only** is selected | Encrypted WebRTC traffic | Relays traffic between peers when NAT or firewall rules prevent a direct path. |

WebRTC encrypts data between the devices, including when it passes through TURN. The TURN provider cannot read the transferred data, but it can observe network addresses and traffic volume. This transport encryption also applies when LiveSync's optional database encryption is disabled. The project does not operate an official TURN service.

## TURN credentials

In **TURN configuration**, select **Manual** to enter your own TURN server URLs,
username, and credential, or select **Managed (Cloudflare)** to enter a **TURN Key ID** and
**TURN Key API Token**. Cloudflare is optional; the project does not require a
particular TURN provider or operate a credential broker. See Cloudflare's
[credential instructions](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
for creating a TURN key and its API token.

The API token is saved with the P2P profile and included when sharing settings
through an existing Setup URI or QR code. Setup URIs retain their existing
passphrase encryption. QR codes retain their existing unencrypted format and
'FOR YOUR EYES ONLY' display. Missing provider settings use the ordinary manual
configuration defaults. Receiving clients need support for the selected provider
to acquire its temporary TURN credentials.
Markdown settings omit the connection profile group when it contains a managed
TURN provider, including inactive profiles, and importing those omitted settings
preserves this device's existing profiles. Diagnostic reports redact provider settings. The existing profile-URI
encryption also covers the saved token.

Each device requests temporary TURN credentials when opening a new room.
An existing room reuses its credentials while they remain valid. Cloudflare credentials have a requested lifetime
of 24 hours and remain in memory only. Expiry is checked when LiveSync next
reconciles the room connection. If necessary, it replaces the room and obtains
new credentials. There is no periodic renewal: if a long-lived room cannot
reconnect after credentials expire, disconnect and open the connection again.

Room replacement may interrupt replication. The next synchronisation keeps
received Metadata and Chunks, resumes from its saved checkpoint, and compares
revisions to fetch missing data. An unfinished network message can be sent
again. Automatic synchronisation follows the existing peer rules; after an
interrupted manual operation, use **Replicate now** again.

## Connection compatibility profiles

`P2P Configuration` includes a separate `Connection compatibility` section. Its defaults preserve the existing transport behaviour:

- **P2P message size** defaults to **Standard**. **Reduced**, **Conservative**, and **Maximum compatibility** progressively limit outgoing P2P messages when a network path appears to drop larger WebRTC messages. This is not a Vault Chunk size or an IP MTU. Smaller values add framing and processing overhead.
- **Connection path** defaults to **Automatic**, which lets WebRTC select a viable direct or TURN-relayed path. **TURN relay only** forces the encrypted connection through TURN and is available when the profile contains a valid manual TURN URL or a configured TURN provider.

The sending device controls its outgoing message size. Select the same conservative preset on every device which may send across the constrained path. Existing devices do not receive the choice retrospectively merely because another device changed it.

Both compatibility choices belong to the saved P2P profile and are retained in P2P connection strings and encrypted Setup URIs. Separate profiles may use the same Group ID, passphrase, and relay list while selecting different compatibility choices. Only the selected P2P profile joins the group.

## P2P Status

The **P2P Status** pane is the current Obsidian interface for P2P connections.

- After a P2P configuration exists, the command **Self-hosted LiveSync: P2P Sync : Open P2P Status** is available from the command palette.
- The P2P ribbon icon appears only after a P2P configuration exists.
- LiveSync does not open the pane merely because Obsidian has started. If the pane was already part of the saved Obsidian workspace, Obsidian may restore it.
- Workspaces containing the retired P2P pane are migrated to the current status pane. The retired command is no longer exposed.

The active P2P remote is selected independently from the main CouchDB or Object Storage remote. Devices can therefore use P2P alongside their main remote without replacing it.

![P2P Status on desktop](../images/p2p-setup/p2p-status-pane.png)

![P2P Status in a mobile layout](../images/p2p-setup/p2p-status-pane-mobile.png)

**Open connection** joins the signalling room and makes the device available for discovery. **Disconnect** leaves the LiveSync room, stops its P2P replication service, and closes the signalling connections. It does not delete the saved P2P profile.

Every participating device must use the same signalling relay set, Group ID, and P2P passphrase. Each device should have a distinct device name. A peer which joins after another device is already connected is advertised to that device; use **Refresh**, or reconnect the device which should be discovered, if a peer is not yet listed.

## Manual and automatic data movement

**Replicate now** performs an explicit bidirectional synchronisation with the selected peer. This is the clearest option when proving a new configuration.

**Announce changes** and **Follow changes** provide a more continuous experience:

- The source device must enable **Announce changes** before it dispatches change notifications.
- A receiving device must enable **Follow changes** for that peer before it fetches in response to those notifications.
- A notification contains no Vault data. It only asks the following peer to fetch through the encrypted P2P connection.
- Missing a notification does not make an explicit later synchronisation unsafe; **Replicate now** still compares the available data.

The peer's **More actions** menu can save these choices for that device:

- **Synchronise when this device connects** runs one synchronisation when that named peer is discovered.
- **Follow whenever this device connects** restores following for that named peer.
- **Include in the P2P synchronisation command** includes that peer when the command for registered targets is run.

![Persistent actions for a detected peer](../images/p2p-setup/guide-p2p-setup-peer-actions-menu.png)

Configure these only after a manual round trip has succeeded. Device names used by persistent rules should remain unique and stable.

## Approval and privacy

A device must approve a peer before serving its data. Permanent approval is stored; session approval lasts only for the current Obsidian session. Check the displayed device name before approving a request.

The encrypted Setup URI contains the shared P2P configuration but deliberately omits the device-specific name. Store the Setup URI and its passphrase separately, and generate a Setup URI for another device from a first device which has completed setup.

## Operational limits

- At least one device which already has the required data must be online while another device fetches it.
- P2P does not provide the continuously available central copy offered by CouchDB or Object Storage. Keep independent backups.
- Mobile operating systems may pause Obsidian in the background. Keep Obsidian visible and the device awake during initial transfer, rebuild, or a large synchronisation.
- Changing from CouchDB to P2P is not a repair operation for a stopped CouchDB setup. Diagnose the existing transport first.
