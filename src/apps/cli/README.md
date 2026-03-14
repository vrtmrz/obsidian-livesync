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
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json sync

# Push files to local database
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json push /your/storage/file.md /vault/path/file.md

# Pull files from local database
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json pull /vault/path/file.md /your/storage/file.md

# Verbose logging
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json --verbose

# Apply setup URI to settings file (settings only; does not run synchronisation)
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json setup "obsidian://setuplivesync?settings=..."

# Put text from stdin into local database
echo "Hello from stdin" | npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json put /vault/path/file.md

# Output a file from local database to stdout
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json cat /vault/path/file.md

# Output a specific revision of a file from local database
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json cat-rev /vault/path/file.md 3-abcdef

# Pull a specific revision of a file from local database to local storage
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json pull-rev /vault/path/file.md /your/storage/file.old.md 3-abcdef

# List files in local database
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json ls /vault/path/

# Show metadata for a file in local database
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json info /vault/path/file.md

# Mark a file as deleted in local database
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json rm /vault/path/file.md

# Resolve conflict by keeping a specific revision
npm run --silent cli -- /path/to/your-local-database --settings /path/to/settings.json resolve /vault/path/file.md 3-abcdef
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
  p2p-peers <timeout>     Show discovered peers as [peer]<TAB><peer-id><TAB><peer-name>
  p2p-sync <peer> <timeout>   Synchronise with specified peer-id or peer-name
  p2p-host                Start P2P host mode and wait until interrupted (Ctrl+C)
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
  mirror <storagePath> <vaultPath>   Mirror local file into local database.
```

Run via npm script:

```bash
npm run --silent cli -- [database-path] [options] [command] [command-args]
```

#### Detailed Command Descriptions

##### ls
`ls` lists files in the local database with optional prefix filtering. Output format is:

```vault/path/file.md<TAB>size<TAB>mtime<TAB>revision[*]
```
Note: `*` indicates if the file has conflicts.

##### p2p-peers

`p2p-peers <timeout>` waits for the specified number of seconds, then prints each discovered peer on a separate line:

```text
[peer]<TAB><peer-id><TAB><peer-name>
```

Use this command to select a target for `p2p-sync`.

##### p2p-sync

`p2p-sync <peer> <timeout>` discovers peers up to the specified timeout and synchronises with the selected peer.

- `<peer>` accepts either `peer-id` or `peer-name` from `p2p-peers` output.
- On success, the command prints a completion message to standard error and exits with status code `0`.
- On failure, the command prints an error message and exits non-zero.

##### p2p-host

`p2p-host` starts the local P2P host and keeps running until interrupted.

- Other peers can discover and synchronise with this host while it is running.
- Stop the host with `Ctrl+C`.
- In CLI mode, behaviour is non-interactive and acceptance follows settings.

##### info

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

##### mirror

`mirror` is a command that synchronises your storage with your local vault. It is essentially a process that runs upon startup in Obsidian.

In other words, it performs the following actions:

1. **Precondition checks** — Aborts early if any of the following conditions are not met:
   - Settings must be configured (`isConfigured: true`).
   - File watching must not be suspended (`suspendFileWatching: false`).
   - Remediation mode must be inactive (`maxMTimeForReflectEvents: 0`).

2. **State restoration** — On subsequent runs (after the first successful scan), restores the previous storage state before proceeding.

3. **Expired deletion cleanup** — If `automaticallyDeleteMetadataOfDeletedFiles` is set to a positive number of days, any document that is marked deleted and whose `mtime` is older than the retention period is permanently removed from the local database.

4. **File collection** — Enumerates files from two sources:
   - **Storage**: all files under the vault path that pass `isTargetFile`.
   - **Local database**: all normal documents (fetched with conflict information) whose paths are valid and pass `isTargetFile`.
   - Both collections build case-insensitive ↔ case-sensitive path maps, controlled by `handleFilenameCaseSensitive`.

5. **Categorisation and synchronisation** — The union of both file sets is split into three groups and processed concurrently (up to 10 files at a time):

   | Group | Condition | Action |
   |---|---|---|
   | **UPDATE DATABASE** | File exists in storage only | Store the file into the local database. |
   | **UPDATE STORAGE** | File exists in database only | If the entry is active (not deleted) and not conflicted, restore the file from the database to storage. Deleted entries and conflicted entries are skipped. |
   | **SYNC DATABASE AND STORAGE** | File exists in both | Compare `mtime` freshness. If storage is newer → write to database (`STORAGE → DB`). If database is newer → restore to storage (`STORAGE ← DB`). If equal → do nothing. Conflicted documents and files exceeding the size limit are always skipped. |

6. **Initialisation flag** — On the very first successful run, writes `initialized = true` to the key-value database so that subsequent runs can restore state in step 2.

Note: `mirror` does not respect file deletions. If a file is deleted in storage, it will be restored on the next `mirror` run. To delete a file, use the `rm` command instead. This is a little inconvenient, but it is intentional behaviour (if we handle this automatically in `mirror`, we should be against a ton of edge cases).

### Planned options:

- `--immediate`: Perform sync after the command (e.g. `push`, `pull`, `put`, `rm`).
- `serve`: Start CLI in server mode, exposing REST APIs for remote, and batch operations.
- `cause-conflicted <vaultPath>`: Mark a file as conflicted without changing its content, to trigger conflict resolution in Obsidian.

## Use Cases

### 1. Bootstrap a new headless vault

Create default settings, apply a setup URI, then run one sync cycle.

```bash
npm run --silent cli -- init-settings /data/livesync-settings.json
printf '%s\n' "$SETUP_PASSPHRASE" | npm run --silent cli -- /data/vault --settings /data/livesync-settings.json setup "$SETUP_URI"
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json sync
```

### 2. Scripted import and export

Push local files into the database from automation, and pull them back for export or backup.

```bash
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json push ./note.md notes/note.md
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json pull notes/note.md ./exports/note.md
```

### 3. Revision inspection and restore

List metadata, find an older revision, then restore it by content (`cat-rev`) or file output (`pull-rev`).

```bash
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json info notes/note.md
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json cat-rev notes/note.md 3-abcdef
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json pull-rev notes/note.md ./restore/note.old.md 3-abcdef
```

### 4. Conflict and cleanup workflow

Inspect conflicted revisions, resolve by keeping one revision, then delete obsolete files.

```bash
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json info notes/note.md
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json resolve notes/note.md 3-abcdef
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json rm notes/obsolete.md
```

### 5. CI smoke test for content round-trip

Validate that `put`/`cat` is behaving as expected in a pipeline.

```bash
echo "hello-ci" | npm run --silent cli -- /data/vault --settings /data/livesync-settings.json put ci/test.md
npm run --silent cli -- /data/vault --settings /data/livesync-settings.json cat ci/test.md
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
