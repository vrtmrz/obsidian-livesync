# Self-hosted LiveSync WebPeer

WebPeer is an experimental, browser-hosted, P2P-only Self-hosted LiveSync peer. It can receive database changes from one peer and provide them to another without materialising ordinary Vault files.

It stores LiveSync metadata and chunks in an origin-scoped local database, but it does not present them as a Vault. This makes it useful as a temporary browser peer or transfer bridge. It is not a durable replacement for CouchDB, a backup, or an always-on server.

## Requirements

WebPeer requires:

- a secure context, such as HTTPS or `localhost`;
- IndexedDB, WebRTC, WebSocket, and Web Crypto support;
- access to the configured signalling relay; and
- the same Group ID, passphrase, and compatible P2P settings as the other peers.

TURN is optional and is needed only when a direct WebRTC connection cannot be established. The signalling relay is required for peer discovery, but it does not store or transfer Vault contents.

## Use

Serve `src/apps/webpeer/dist/` over HTTPS, or from `localhost`, then open `index.html`.

1. Enable the P2P replicator.
2. Enter the signalling relay, Group ID, passphrase, and a unique device name.
3. Select **Save and Apply**.
4. Select **Connect** and wait for the intended peers to appear.
5. Use the peer actions to fetch, send, watch, or configure automatic synchronisation as required.

**Start change-broadcasting on Connect** allows watching peers to notice changes and fetch them. It does not send Vault data through the signalling relay. Optional TURN settings are available separately.

Keep the page open while WebPeer is expected to announce or transfer changes.

## P2P connection check

`check.html` provides a disposable preflight check for P2P connectivity. It creates a random encrypted Setup URI and QR code locally, joins the generated room as a browser reference peer only after explicit confirmation, and displays the browser's WebRTC diagnostic totals beside the QR code.

Use a dedicated empty Vault for every device:

1. Select desktop or mobile, then prepare the check.
2. Start the browser connection monitor.
3. Open or scan the Setup URI in an empty Vault with Self-hosted LiveSync installed and enabled.
4. Enter the separately displayed Setup URI passphrase.
5. Keep both peers open for the observation period and watch the successful-connection total.
6. Use **Show the Setup QR again** to return to the existing configuration without regenerating it.
7. For the clearest device comparison, start a fresh check before testing the other device.

A successful total greater than zero means that the browser and target established at least one WebRTC connection. It does not verify note synchronisation, sustained connectivity, or a direct desktop-to-mobile path. If representative checks repeatedly do not connect, CouchDB is the more predictable synchronisation option. An optional final check can use two disposable empty Vaults to verify a note round trip directly between the user's devices.

After the first device connects, **Try another device without resetting** keeps the browser, room, credentials, first device, and cumulative counters in place. The page records a local baseline, shows the same QR code for another empty Vault, and reports an additional connection only after both a new successful connection state and another simultaneous active connection appear. Keep the first device connected. Connections are not device identities, so this same-room route is convenient but a fresh check remains easier to interpret because reconnect activity is isolated.

Serve the production build over HTTPS or from `localhost`. Downloading `check.html` alone is not supported because the page uses built module assets and origin-scoped browser storage. The generated credentials are temporary and must not replace the settings of a production Vault.

The detailed scope and result semantics are recorded in the [browser-assisted P2P connection-check ADR](../../../docs/adr/2026_07_p2p_connection_check.md).

## Storage and lifecycle

WebPeer stores its settings, metadata, and chunks in storage belonging to the page origin. Consequently:

- changing the scheme, host, or port creates a different WebPeer state;
- clearing site data removes the local database and settings;
- browser storage eviction can remove the state; and
- page suspension, tab closure, device sleep, and network policy can interrupt P2P activity.

Use a separately deployed origin when isolation from the public Pages deployment is required. Do not treat WebPeer browser storage as the only copy of any data.

## Troubleshooting

### No peers appear

- Confirm that every peer uses the same signalling relay, Group ID, and passphrase.
- Confirm that each peer has a distinct device name.
- Confirm that P2P is enabled and that the signalling connection reports **Connected**.
- Check whether the browser or network blocks the relay WebSocket.

### Peers connect but changes do not transfer

- Confirm which peer should fetch and which should send.
- Start broadcasting on the source when another peer is watching it.
- Use the explicit fetch or send action to test one direction.
- Confirm that the peers use compatible Self-hosted LiveSync versions and P2P settings.

### Saved settings or data appear to be missing

- Confirm that the page is using the same origin as before.
- Check whether site data was cleared or evicted.
- Check the status line and WebPeer log for the first reported error.

For more detail about relay, TURN, announcing, and following behaviour, see the [P2P guide](../../../docs/p2p.md).

## Development

Build it from the repository root:

```bash
npm run build --workspace webpeer
```

The app-owned unit and Chromium tests can be run with:

```bash
npm run test:unit --workspace webpeer
npm run test:browser --workspace webpeer
```

The focused browser-to-Obsidian E2E test builds both production artefacts, manages the local Compose P2P relay, applies the browser-generated Setup URI to two isolated empty Vaults without resetting the browser room, and retains the successful additional-device result under the Obsidian diagnostics directory:

```bash
npm run test:e2e:obsidian:p2p-connection-check:services
```

Configure `OBSIDIAN_BINARY` and `OBSIDIAN_CLI` when the E2E runner cannot discover them automatically.

The unit tests are stored in `test/apps/webpeer/`, outside the Community Review source boundary.

## Composition

The WebPeer production bundle has two HTML entry points. `index.html` loads `src/main.ts` and the ordinary browser peer, while `check.html` loads `src/check.ts` and the isolated P2P connection check. The ordinary page links to the check, so it is a WebPeer feature without sharing its saved settings or runtime session.

`WebPeerRuntime.ts` owns the browser service composition, local database lifecycle, P2P replicator, and peer actions. `WebPeerPersistence.ts` owns origin-scoped settings persistence, while the shared P2P pane supplies the connection and peer controls. The connection-check modules create an isolated runtime with in-memory test settings and derive user-visible results from Commonlib's browser-side diagnostic events. Both entry points use the same WebPeer visual foundation.

## Licence

The same licence as the main Self-hosted LiveSync project applies.
