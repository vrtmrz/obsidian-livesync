# Self-hosted LiveSync CLI
Command-line version of Self-hosted LiveSync plugin for syncing vaults without Obsidian.

## Features

- ✅ Sync Obsidian vaults using CouchDB without running Obsidian
- ✅ Compatible with Self-hosted LiveSync plugin settings
- ✅ Supports all core sync features (encryption, conflict resolution, etc.)
- ✅ Lightweight and headless operation
- ✅ Cross-platform (Windows, macOS, Linux)

## Architecture

This CLI version is built using the same core as the Obsidian plugin:

```
CLI Main
  └─ LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>
     ├─ NodeServiceHub (All services without Obsidian dependencies)
     └─ ServiceModules (wired by initialiseServiceModulesCLI)
        ├─ FileAccessCLI (Node.js FileSystemAdapter)
        ├─ StorageEventManagerCLI
        ├─ ServiceFileAccessCLI
        ├─ ServiceDatabaseFileAccessCLI
        ├─ ServiceFileHandler
        └─ ServiceRebuilder
```

### Key Components

1. **Node.js FileSystem Adapter** (`adapters/`)
    - Platform-agnostic file operations using Node.js `fs/promises`
    - Implements same interface as Obsidian's file system

2. **Service Modules** (`serviceModules/`)
    - Initialised by `initialiseServiceModulesCLI`
    - All core sync functionality preserved

3. **Service Hub and Settings Services** (`services/`)
    - `NodeServiceHub` provides the CLI service context
    - Node-specific settings and key-value services are provided without Obsidian dependencies

4. **Main Entry Point** (`main.ts`)
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
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json sync

# Push files to local database
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json push /your/storage/file.md /vault/path/file.md

# Pull files from local database
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json pull /vault/path/file.md /your/storage/file.md

# Verbose logging
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json --verbose

# Apply setup URI to settings file (settings only; does not run synchronisation)
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json setup "obsidian://setuplivesync?settings=..."

# Put text from stdin into local database
echo "Hello from stdin" | npm run cli -- /path/to/your-local-database --settings /path/to/settings.json put /vault/path/file.md

# Output a file from local database to stdout
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json cat /vault/path/file.md

# Output a specific revision of a file from local database
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json cat-rev /vault/path/file.md 3-abcdef

# Pull a specific revision of a file from local database to local storage
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json pull-rev /vault/path/file.md /your/storage/file.old.md 3-abcdef

# List files in local database
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json ls /vault/path/

# Show metadata for a file in local database
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json info /vault/path/file.md

# Mark a file as deleted in local database
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json rm /vault/path/file.md

# Resolve conflict by keeping a specific revision
npm run cli -- /path/to/your-local-database --settings /path/to/settings.json resolve /vault/path/file.md 3-abcdef
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

### Command-line Reference

```
Usage:
  livesync-cli [database-path] [options] [command] [command-args]

Arguments:
  database-path           Path to the local database directory (required except for init-settings)

Options:
  --settings, -s <path>   Path to settings file (default: .livesync/settings.json in local database directory)
  --force, -f             Overwrite existing file on init-settings
  --verbose, -v           Enable verbose logging
  --help, -h              Show this help message

Commands:
  init-settings [path]    Create settings JSON from DEFAULT_SETTINGS
  sync                    Run one replication cycle and exit
  push <src> <dst>        Push local file <src> into local database path <dst>
  pull <src> <dst>        Pull file <src> from local database into local file <dst>
  pull-rev <src> <dst> <revision>   Pull specific revision into local file <dst>
  setup <setupURI>        Apply setup URI to settings file
  put <vaultPath>         Read text from standard input and write to local database
  cat <vaultPath>         Write latest file content from local database to standard output
  cat-rev <vaultPath> <revision>   Write specific revision content from local database to standard output
  ls [prefix]             List files as path<TAB>size<TAB>mtime<TAB>revision[*]
  info <vaultPath>        Show file metadata including current and past revisions, conflicts, and chunk list
  rm <vaultPath>          Mark file as deleted in local database
  resolve <vaultPath> <revision>   Resolve conflict by keeping the specified revision
```

Run via npm script:

```bash
npm run cli -- [database-path] [options] [command] [command-args]
```

`info` output fields:

- `id`: Document ID
- `revision`: Current revision
- `conflicts`: Conflicted revisions, or `N/A`
- `filename`: Basename of path
- `path`: Vault-relative path
- `size`: Size in bytes
- `revisions`: Available non-current revisions
- `chunks`: Number of chunk IDs
- `children`: Chunk ID list

### Planned options:

TODO: Conflict and resolution checks for real local databases.

- `--immediate`: Perform sync after the command (e.g. `push`, `pull`, `put`, `rm`).
- `serve`: Start CLI in server mode, exposing REST APIs for remote, and batch operations.
- `cause-conflicted <vaultPath>`: Mark a file as conflicted without changing its content, to trigger conflict resolution in Obsidian.

## Use Cases

### 1. Bootstrap a new headless vault

Create default settings, apply a setup URI, then run one sync cycle.

```bash
npm run cli -- init-settings /data/livesync-settings.json
printf '%s\n' "$SETUP_PASSPHRASE" | npm run cli -- /data/vault --settings /data/livesync-settings.json setup "$SETUP_URI"
npm run cli -- /data/vault --settings /data/livesync-settings.json sync
```

### 2. Scripted import and export

Push local files into the database from automation, and pull them back for export or backup.

```bash
npm run cli -- /data/vault --settings /data/livesync-settings.json push ./note.md notes/note.md
npm run cli -- /data/vault --settings /data/livesync-settings.json pull notes/note.md ./exports/note.md
```

### 3. Revision inspection and restore

List metadata, find an older revision, then restore it by content (`cat-rev`) or file output (`pull-rev`).

```bash
npm run cli -- /data/vault --settings /data/livesync-settings.json info notes/note.md
npm run cli -- /data/vault --settings /data/livesync-settings.json cat-rev notes/note.md 3-abcdef
npm run cli -- /data/vault --settings /data/livesync-settings.json pull-rev notes/note.md ./restore/note.old.md 3-abcdef
```

### 4. Conflict and cleanup workflow

Inspect conflicted revisions, resolve by keeping one revision, then delete obsolete files.

```bash
npm run cli -- /data/vault --settings /data/livesync-settings.json info notes/note.md
npm run cli -- /data/vault --settings /data/livesync-settings.json resolve notes/note.md 3-abcdef
npm run cli -- /data/vault --settings /data/livesync-settings.json rm notes/obsolete.md
```

### 5. CI smoke test for content round-trip

Validate that `put`/`cat` is behaving as expected in a pipeline.

```bash
echo "hello-ci" | npm run cli -- /data/vault --settings /data/livesync-settings.json put ci/test.md
npm run cli -- /data/vault --settings /data/livesync-settings.json cat ci/test.md
```

## Development

### Project Structure

```
src/apps/cli/
├── commands/            # Command dispatcher and command utilities
│   ├── runCommand.ts
│   ├── runCommand.unit.spec.ts
│   ├── types.ts
│   ├── utils.ts
│   └── utils.unit.spec.ts
├── adapters/            # Node.js FileSystem Adapter
│   ├── NodeConversionAdapter.ts
│   ├── NodeFileSystemAdapter.ts
│   ├── NodePathAdapter.ts
│   ├── NodeStorageAdapter.ts
│   ├── NodeStorageAdapter.unit.spec.ts
│   ├── NodeTypeGuardAdapter.ts
│   ├── NodeTypes.ts
│   └── NodeVaultAdapter.ts
├── lib/
│   └── pouchdb-node.ts
├── managers/            # CLI-specific managers
│   ├── CLIStorageEventManagerAdapter.ts
│   └── StorageEventManagerCLI.ts
├── serviceModules/      # Service modules (ported from main.ts)
│   ├── CLIServiceModules.ts
│   ├── DatabaseFileAccess.ts
│   ├── FileAccessCLI.ts
│   └── ServiceFileAccessImpl.ts
├── services/
│   ├── NodeKeyValueDBService.ts
│   ├── NodeServiceHub.ts
│   └── NodeSettingService.ts
├── test/
│   ├── test-e2e-two-vaults-common.sh
│   ├── test-e2e-two-vaults-matrix.sh
│   ├── test-e2e-two-vaults-with-docker-linux.sh
│   ├── test-push-pull-linux.sh
│   ├── test-setup-put-cat-linux.sh
│   └── test-sync-two-local-databases-linux.sh
├── .gitignore
├── entrypoint.ts         # CLI executable entry point (shebang)
├── main.ts              # CLI entry point
├── main.unit.spec.ts
├── package.json
├── README.md            # This file
├── tsconfig.json
├── util/                # Test and local utility scripts
└── vite.config.ts
```
