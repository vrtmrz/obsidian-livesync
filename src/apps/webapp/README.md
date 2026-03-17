# LiveSync WebApp
Browser-based implementation of Self-hosted LiveSync using the FileSystem API.
Note: (I vrtmrz have not tested this so much yet).

## Features

- 🌐 Runs entirely in the browser
- 📁 Uses FileSystem API to access your local vault
- 🔄 Syncs with CouchDB, Object Storage server (compatible with Self-hosted LiveSync plugin)
- 🚫 No server-side code required!!
- 💾 Settings stored in `.livesync/settings.json` within your vault
- 👁️ Real-time file watching (Chrome 124+ with FileSystemObserver)

## Requirements

- **FileSystem API support**:
    - Chrome/Edge 86+ (required)
    - Opera 72+ (required)
    - Safari 15.2+ (experimental, limited support)
    - Firefox: Not supported yet

- **FileSystemObserver support** (optional, for real-time file watching):
    - Chrome 124+ (recommended)
    - Without this, files are only scanned on startup

## Getting Started

### Installation

```bash
# Install dependencies (ensure you are in repository root directory, not src/apps/cli)
# due to shared dependencies with webapp and main library
npm install
```

### Development

```bash
# Build the project (ensure you are in `src/apps/webapp` directory)
cd src/apps/webapp
npm run dev
```

This will start a development server at `http://localhost:3000`.

### Build

```bash
# Build the project (ensure you are in `src/apps/webapp` directory)
cd src/apps/webapp
npm run build
```

The built files will be in the `dist` directory.

### Usage

1. Open the webapp in your browser (`webapp.html`)
2. Select a vault from history or grant access to a new directory
3. Configure CouchDB connection by editing `.livesync/settings.json` in your vault
    - You can also copy data.json from Obsidian's plug-in folder.

Example `.livesync/settings.json`:

```json
{
    "couchDB_URI": "https://your-couchdb-server.com",
    "couchDB_USER": "your-username",
    "couchDB_PASSWORD": "your-password",
    "couchDB_DBNAME": "your-database",
    "isConfigured": true,
    "liveSync": true,
    "syncOnSave": true
}
```

After editing, reload the page.

## Architecture

### Directory Structure

```
webapp/
├── adapters/             # FileSystem API adapters
│   ├── FSAPITypes.ts
│   ├── FSAPIPathAdapter.ts
│   ├── FSAPITypeGuardAdapter.ts
│   ├── FSAPIConversionAdapter.ts
│   ├── FSAPIStorageAdapter.ts
│   ├── FSAPIVaultAdapter.ts
│   └── FSAPIFileSystemAdapter.ts
├── managers/             # Event managers
│   ├── FSAPIStorageEventManagerAdapter.ts
│   └── StorageEventManagerFSAPI.ts
├── serviceModules/       # Service implementations
│   ├── FileAccessFSAPI.ts
│   ├── ServiceFileAccessImpl.ts
│   ├── DatabaseFileAccess.ts
│   └── FSAPIServiceModules.ts
├── bootstrap.ts         # Vault picker + startup orchestration
├── main.ts              # LiveSync core bootstrap (after vault selected)
├── vaultSelector.ts     # FileSystem handle history and permission flow
├── webapp.html          # Main HTML entry
├── index.html           # Redirect entry for compatibility
├── package.json
├── vite.config.ts
└── README.md
```

### Key Components

1. **Adapters**: Implement `IFileSystemAdapter` interface using FileSystem API
2. **Managers**: Handle storage events and file watching
3. **Service Modules**: Integrate with LiveSyncBaseCore
4. **Main**: Application initialization and lifecycle management

### Service Hub

Uses `BrowserServiceHub` which provides:

- Database service (IndexedDB via PouchDB)
- Settings service (file-based in `.livesync/settings.json`)
- Replication service
- File processing service
- And more...

## Limitations

- **Real-time file watching**: Requires Chrome 124+ with FileSystemObserver
    - Without it, changes are only detected on manual refresh
- **Performance**: Slower than native file system access
- **Permissions**: Requires user to grant directory access (cached via IndexedDB)
- **Browser support**: Limited to browsers with FileSystem API support

## Differences from CLI Version

- Uses `BrowserServiceHub` instead of `HeadlessServiceHub`
- Uses FileSystem API instead of Node.js `fs`
- Settings stored in `.livesync/settings.json` in vault
- Real-time file watching only with FileSystemObserver (Chrome 124+)

## Differences from Obsidian Plugin

- No Obsidian-specific modules (UI, settings dialog, etc.)
- Simplified configuration
- No plugin/theme sync features
- No internal file handling (`.obsidian` folder)

## Development Notes

- TypeScript configuration: Uses project's tsconfig.json
- Module resolution: Aliased paths via Vite config
- External dependencies: Bundled by Vite

## Troubleshooting

### "Failed to get directory access"

- Make sure you're using a supported browser
- Try refreshing the page
- Clear browser cache and IndexedDB

### "Settings not found"

- Check that `.livesync/settings.json` exists in your vault directory
- Verify the JSON format is valid
- Create the file manually if needed

### "File watching not working"

- Make sure you're using Chrome 124 or later
- Check browser console for FileSystemObserver messages
- Try manually triggering sync if automatic watching isn't available

### "Sync not working"

- Verify CouchDB credentials
- Check browser console for errors
- Ensure CouchDB server is accessible (CORS enabled)

## License

Same as the main Self-hosted LiveSync project.
