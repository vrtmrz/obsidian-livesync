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

The unit tests are stored in `test/apps/webpeer/`, outside the Community Review source boundary.

## Composition

`WebPeerRuntime.ts` owns the browser service composition, local database lifecycle, P2P replicator, and peer actions. `WebPeerPersistence.ts` owns origin-scoped settings persistence, while the shared P2P pane supplies the connection and peer controls.

## Licence

The same licence as the main Self-hosted LiveSync project applies.
