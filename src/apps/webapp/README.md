# Self-hosted LiveSync WebApp

WebApp is an experimental proof of concept for running Self-hosted LiveSync against a browser-authorised local Vault. It is not a replacement for the Obsidian plug-in, and it does not provide the plug-in's settings screen, command palette, or setup wizard.

## Capabilities

- Runs as a static application in the browser.
- Reads and writes a user-selected Vault through the File System Access API.
- Keeps previously selected directory handles in origin-scoped IndexedDB.
- Loads and saves LiveSync settings in `.livesync/settings.json` inside the selected Vault.
- Uses CouchDB as its primary continuous remote.
- Provides optional P2P controls as a secondary connection.
- Scans the Vault on start-up and when **Scan local files** is selected.
- Watches external file changes automatically when `FileSystemObserver` is available.

The WebApp itself does not require an application server, but synchronisation still requires a compatible remote or P2P peer.

## Requirements

WebApp requires:

- a secure context, such as HTTPS or `localhost`;
- `showDirectoryPicker()` and read-write access to the selected directory;
- IndexedDB for saved directory handles and the local database; and
- a CouchDB server which permits requests from the WebApp origin when CouchDB is used.

Automated browser coverage uses Chromium. Other browsers, background execution, and remote types other than CouchDB remain experimental. Use feature detection rather than relying on a fixed browser-version list.

## Use

Serve the built files over HTTPS, or from `localhost`, then open `webapp.html`.

1. Select the local Vault root.
2. Create or edit `.livesync/settings.json` in that Vault.
3. Reload WebApp to apply the settings.

For example, a minimal manually configured CouchDB connection includes:

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

The settings must match the remote database, including any encryption and compatibility settings which are already in use. The file may contain credentials and passphrases, so protect it accordingly. Review individual values instead of copying an Obsidian `data.json` file wholesale.

### Optional P2P

The visible P2P controls are optional. Saving them does not select P2P as the main remote or mark an otherwise unconfigured Vault as configured. Use **Scan local files** before offering existing Vault content to a peer when automatic file observation is unavailable.

## Limitations

- There is no general settings screen, setup wizard, or command palette.
- Object Storage and other main-remote configurations remain experimental and are not covered by the current WebApp browser tests.
- Without `FileSystemObserver`, external changes are detected only by a start-up or manual scan.
- A browser may suspend the page, discard permissions, or evict origin-scoped storage.
- The File System Access API is not available in every browser.
- Customisation Sync and Obsidian-specific Vault features are unavailable.

## Troubleshooting

### A Vault cannot be opened

- Confirm that WebApp is served over HTTPS or from `localhost`.
- Grant read-write access when the browser prompts.
- If a saved handle no longer has permission, select **Choose new vault folder** and choose the same directory again.

### Settings are not loaded

- Confirm that `.livesync/settings.json` exists under the selected Vault root.
- Confirm that the file contains one valid JSON object.
- Reload WebApp after editing the file.
- Check the status line and browser console for the first reported error.

### External file changes are not detected

- Select **Scan local files** after making changes outside WebApp.
- Check whether the browser provides `FileSystemObserver`.
- Keep the page open while automatic watching or synchronisation is expected.

### CouchDB does not synchronise

- Confirm the URL, credentials, database name, encryption settings, and compatibility settings.
- Confirm that CouchDB permits requests from the WebApp origin.
- Check the browser network inspector and console for the rejected request.

## Development

From the repository root:

```bash
npm run dev --workspace livesync-webapp
npm run build --workspace livesync-webapp
npm run test:unit --workspace livesync-webapp
npm run test:browser --workspace livesync-webapp
```

The production files are written to `src/apps/webapp/dist/`. App-owned unit tests are stored in `test/apps/webapp/`, outside the Community Review source boundary. The browser test builds the production artefact, selects an OPFS-backed test Vault in Chromium, and verifies start-up and P2P setting isolation.

## Composition

`WebAppRuntime.ts` owns the LiveSync service composition and lifecycle. `main.ts` owns Vault selection and the small browser shell, while `adapters/`, `managers/`, and `serviceModules/` provide the File System Access API boundary.

## Licence

The same licence as the main Self-hosted LiveSync project applies.
