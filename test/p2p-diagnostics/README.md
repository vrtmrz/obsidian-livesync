# P2P diagnostic UI checks

These checks use Node.js 24 or newer, the existing Playwright dependency, and a
Chromium installation.
The Log Pane fixture starts with a buffered diagnostic message and suppresses
ordinary logger output, modelling a report opened while ordinary INFO messages
are hidden. It checks initial display, later events, and unmounting. The status-card fixture
also checks three summary rows at a narrow viewport and the existing Log Pane
link. The full status-pane fixture exercises accepted, session-accepted, new,
and denied peers at 320, 390, and 768 px, including long names. It checks bounds,
complete action labels, and existing sync/admission callbacks. The card check
also verifies initially collapsed diagnostic details, keyboard toggling, and
updates received while collapsed. Host view, Menu, and SetupManager capabilities
are stubbed; the Svelte components and shared log store are real, while P2P and
Obsidian capabilities are fixtures. Add `?preview` to the status-pane URL for a
shorter illustrative peer list.

From the repository root, start the fixture server:

```sh
NODE_OPTIONS=--max-old-space-size=3072 node node_modules/vite/bin/vite.js --config test/p2p-diagnostics/vite.config.mjs
```

In another terminal, run the focused browser check:

```sh
NODE_OPTIONS=--max-old-space-size=3072 node --test --test-concurrency=1 test/p2p-diagnostics/log-pane.test.ts test/p2p-diagnostics/status-pane.test.ts
```

The default endpoint is `http://127.0.0.1:5157`. Set `DIAG_UI_BASE_URL` when using
another endpoint. Stop the fixture server after the check. This browser fixture
does not replace verification in Obsidian.
