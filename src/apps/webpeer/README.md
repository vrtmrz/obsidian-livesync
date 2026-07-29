# Self-hosted LiveSync WebPeer

WebPeer is a browser-hosted, P2P-only Self-hosted LiveSync peer. It can receive database changes from one peer and provide them to another without materialising ordinary Vault files.

Build it from the repository root:

```bash
npm run build --workspace webpeer
```

Serve `src/apps/webpeer/dist/` over HTTPS, or from `localhost`, open `index.html`, and configure the same Group ID, passphrase, signalling relay, and optional TURN settings as the other peers. Keep the page open while it is expected to announce or transfer changes.

WebPeer stores its settings, metadata, and chunks in origin-scoped browser storage. Clearing site data removes this state. Browser suspension, storage eviction, tab lifecycle, and network policy mean that WebPeer is not an always-on server.

The app-owned unit and Chromium tests can be run with:

```bash
npm run test:unit --workspace webpeer
npm run test:browser --workspace webpeer
```

The unit tests are stored in `test/apps/webpeer/`, outside the Community Review source boundary.

## Licence

The same licence as the main Self-hosted LiveSync project applies.
