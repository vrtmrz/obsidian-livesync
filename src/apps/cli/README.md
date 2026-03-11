# Self-hosted LiveSync CLI
Command-line version of Obsidian LiveSync plugin for syncing vaults without Obsidian.

## Features

- ✅ Sync Obsidian vaults using CouchDB without running Obsidian
- ✅ Compatible with Obsidian LiveSync plugin settings
- ✅ Supports all core sync features (encryption, conflict resolution, etc.)
- ✅ Lightweight and headless operation
- ✅ Cross-platform (Windows, macOS, Linux)

## Architecture

This CLI version is built using the same core as the Obsidian plugin:

```
CLI Main
  └─ LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>
     ├─ HeadlessServiceHub (All services without Obsidian dependencies)
     └─ ServiceModules (Ported from main.ts)
        ├─ FileAccessCLI (Node.js FileSystemAdapter)
        ├─ StorageEventManagerCLI
        ├─ ServiceFileAccessCLI
        ├─ ServiceDatabaseFileAccess
        ├─ ServiceFileHandler
        └─ ServiceRebuilder
```

### Key Components

1. **Node.js FileSystem Adapter** (`adapters/`)
    - Platform-agnostic file operations using Node.js `fs/promises`
    - Implements same interface as Obsidian's file system

2. **Service Modules** (`serviceModules/`)
    - Direct port from `main.ts` `initialiseServiceModules`
    - All core sync functionality preserved

3. **Main Entry Point** (`main.ts`)
    - Command-line interface
    - Settings management (JSON file)
    - Graceful shutdown handling

## Installation

```bash
# Install dependencies (ensure you are in repository root directory, not src/apps/cli)
# due to shared dependencies with webapp and main library
npm install
# Build the project (ensure you are in `src/apps/cli` directory)
npm run build
```

## Usage

### Basic Usage

As you know, the CLI is designed to be used in a headless environment. Hence all operations are performed against a local vault directory and a settings file. Here are some example commands:

```bash
# Sync local database with CouchDB (no files will be changed).
node dist/cli/index.js /path/to/your-local-database --settings /path/to/settings.json sync

# Push files to local database
node dist/cli/index.js /path/to/your-local-database --settings /path/to/settings.json push /your/storage/file.md /vault/path/file.md

# Pull files from local database
node dist/cli/index.js /path/to/your-local-database --settings /path/to/settings.json pull /vault/path/file.md /your/storage/file.md

# Verbose logging
node dist/cli/index.js /path/to/your-local-database --settings /path/to/settings.json --verbose
```

### Configuration

The CLI uses the same settings format as the Obsidian plugin. Create a `.livesync/settings.json` file in your vault directory:

```json
{
    "couchDB_URI": "http://localhost:5984",
    "couchDB_USER": "admin",
    "couchDB_PASSWORD": "password",
    "couchDB_DBNAME": "obsidian-livesync",
    "liveSync": true,
    "syncOnSave": true,
    "syncOnStart": true,
    "encrypt": true,
    "passphrase": "your-encryption-passphrase",
    "usePluginSync": false,
    "isConfigured": true
}
```

**Minimum required settings:**

- `couchDB_URI`: CouchDB server URL
- `couchDB_USER`: CouchDB username
- `couchDB_PASSWORD`: CouchDB password
- `couchDB_DBNAME`: Database name
- `isConfigured`: Set to `true` after configuration

### Command-line Options

```
Usage:
  livesync-cli [database-path] [options]

Arguments:
  database-path           Path to the local database directory (required)

Options:
  --settings, -s <path>   Path to settings file (default: .livesync/settings.json in local database directory)
  --verbose, -v           Enable verbose logging
  --help, -h              Show this help message
  sync                    Sync local database with CouchDB or Bucket
  push <storagePath> <vaultPath>   Push file to local database
  pull <vaultPath> <storagePath>   Pull file from local database
```

### Planned options:

- `put <vaultPath>`: Add/update file in local database from standard input
- `cat <vaultPath>`: Output file content to standard output
- `info <vaultPath>`: Show file metadata, conflicts, and, other information
- `ls <prefix>`: List files in local database with optional prefix filter
- `resolve <vaultPath> <revision>`: Resolve conflict for a file by choosing a specific revision
- `rm <vaultPath>`: Remove file from local database.
- `--immediate`: Perform sync after the command (e.g. `push`, `pull`, `put`, `rm`).
- `serve`: Start CLI in server mode, exposing REST APIs for remote, and batch operations.

## Use Cases

## Development

### Project Structure

```
src/apps/cli/
├── adapters/           # Node.js FileSystem Adapter
│   ├── NodeFileSystemAdapter.ts
│   ├── NodePathAdapter.ts
│   ├── NodeTypeGuardAdapter.ts
│   ├── NodeConversionAdapter.ts
│   ├── NodeStorageAdapter.ts
│   ├── NodeVaultAdapter.ts
│   └── NodeTypes.ts
├── managers/           # CLI-specific managers
│   ├── CLIStorageEventManagerAdapter.ts
│   └── StorageEventManagerCLI.ts
├── serviceModules/     # Service modules (ported from main.ts)
│   ├── CLIServiceModules.ts
│   ├── FileAccessCLI.ts
│   ├── ServiceFileAccessImpl.ts
│   └── DatabaseFileAccess.ts
├── main.ts            # CLI entry point
└── README.md          # This file
```
