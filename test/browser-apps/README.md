# Browser application tests

Browser application tests use Deno and headless Chromium. They do not depend on Obsidian or the retired browser Harness.

Application unit tests are stored in `test/apps/webapp/` and `test/apps/webpeer/`. Both the unit and browser tests remain outside `src`, because test-file ignores do not apply to the Community Review source boundary.

Each application has its own production-bundle smoke-test directory outside `src`:

- `test/browser-apps/webapp/` covers Vault selection, OPFS start-up, and isolation between optional P2P settings and the main remote.
- `test/browser-apps/webpeer/` covers start-up, settings persistence, and reload.
- `test/browser-apps/pages/` covers the final GitHub Pages layout, application subpaths, and relative assets.

Run both app-owned tests with:

```bash
npm run test:browser-apps
```

`test/browser-apps/interop.test.ts` is the only cross-application scenario. It configures the real WebApp and WebPeer interfaces, transfers a file from WebApp to WebPeer, then starts the built CLI as the final peer and verifies the file through the production CLI. The CLI is a test fixture in this scenario; the PoC test and its support code are not owned by the CLI package.

Run the isolated relay and TURN scenario in Compose with:

```bash
npm run test:e2e:browser-apps:interop
```

After assembling the GitHub Pages files in `_site`, run the package smoke test with:

```bash
npm run test:browser-apps:pages
```

Set `PAGES_SITE_ROOT` to test an assembled site in another directory.

The Deno dependency lock is shared only by these browser application tests.
