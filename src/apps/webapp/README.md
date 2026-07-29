# Self-hosted LiveSync WebApp

WebApp is an experimental proof of concept for running Self-hosted LiveSync against a browser-authorised local Vault. It is not a replacement for the Obsidian plug-in, and it does not provide the plug-in's settings screen, command palette, or setup wizard.

## Use

WebApp requires a browser which provides the File System Access API and IndexedDB. Serve the built files over HTTPS, or from `localhost`, then open `webapp.html`.

1. Select the local Vault root.
2. Create or edit `.livesync/settings.json` in that Vault.
3. Reload WebApp to apply the settings.

For example, a manually configured CouchDB connection includes:

```json
{
    "couchDB_URI": "https://couchdb.example.com",
    "couchDB_USER": "username",
    "couchDB_PASSWORD": "password",
    "couchDB_DBNAME": "vault",
    "isConfigured": true,
    "liveSync": true,
    "syncOnSave": true
}
```

The visible P2P controls are optional. Saving them does not select P2P as the main remote or mark an otherwise unconfigured Vault as configured.

CouchDB must permit access from the WebApp origin. Other remote types, browser background behaviour, and browsers without the required file-system APIs remain experimental.

## Development

From the repository root:

```bash
npm run dev --workspace livesync-webapp
npm run build --workspace livesync-webapp
npm run test:unit --workspace livesync-webapp
npm run test:browser --workspace livesync-webapp
```

The production files are written to `src/apps/webapp/dist/`. App-owned unit tests are stored in `test/apps/webapp/`, outside the Community Review source boundary. The browser test builds the production artefact, selects an OPFS-backed test Vault in Chromium, and verifies start-up and P2P setting isolation.

`WebAppRuntime.ts` owns the LiveSync service composition and lifecycle. `main.ts` owns Vault selection and the small browser shell, while `adapters/`, `managers/`, and `serviceModules/` provide the File System Access API boundary.

## Licence

The same licence as the main Self-hosted LiveSync project applies.
