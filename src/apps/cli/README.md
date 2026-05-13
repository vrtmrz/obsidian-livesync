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

## Usage

The CLI operates on a **database directory** which contains PouchDB data and settings.

> [!NOTE]
> `livesync-cli` is the alias for the CLI executable. Please replace with the actual command of your installation (e.g. `npm run --silent cli --` or `docker run ...`).

```bash
livesync-cli [database-path] [command] [args...]
```


### Arguments

- `database-path`: Path to the directory where `.livesync` folder and `settings.json` are (or will be) located.
    - Note: In previous versions, this was referred to as the "vault" path. Now it is clearly distinguished from the actual vault (the directory containing your `.md` files).

### Commands

- `sync`: Run one replication cycle with the remote CouchDB.
- `mirror [vault-path]`: Bidirectional sync between the local database and a local directory (**the actual vault**).
    - If `vault-path` is provided, the CLI will synchronise the database with files in the vault directory.
    - If `vault-path` is omitted, it defaults to `database-path` (compatibility mode).
    - Use this command to keep your local `.md` files in sync with the database.
- `ls [prefix]`: List files currently stored in the local database.
- `push <src> <dst>`: Push a local file `<src>` into the database at path `<dst>`.
- `pull <src> <dst>`: Pull a file `<src>` from the database into local file `<dst>`.
- `cat <src>`: Read a file from the database and write to stdout.
- `put <dst>`: Read from stdin and write to the database path `<dst>`.
- `init-settings [file]`: Create a default settings file.

### Examples

```bash
# Basic sync with remote
livesync-cli ./my-db sync

# Mirroring to your actual Obsidian vault
livesync-cli ./my-db mirror /path/to/obsidian-vault

# Manual file operations
livesync-cli ./my-db push ./note.md folder/note.md
livesync-cli ./my-db pull folder/note.md ./note.md
```

## Installation

### Build from source

```bash
# Clone with submodules, because the shared core lives in src/lib
git clone --recurse-submodules <repository-url>
cd obsidian-livesync

# If you already cloned without submodules, run this once instead
git submodule update --init --recursive

# Install dependencies from the repository root
npm install

# Build the CLI from its package directory
cd src/apps/cli
npm run build
```

If `src/lib` is missing, `npm run build` now stops early with a targeted message
instead of a low-level Vite `ENOENT` error.

Run the CLI:

```bash
# Run with npm script (from repository root)
npm run --silent cli -- [database-path] [command] [args...]
# Run the built executable directly
node src/apps/cli/dist/index.cjs [database-path] [command] [args...]
```

### Docker

A Docker image is provided for headless / server deployments. Build from the repository root:

```bash
docker build -f src/apps/cli/Dockerfile -t livesync-cli .
```

Run:

```bash
# Sync with CouchDB
docker run --rm -v /path/to/your/db:/data livesync-cli sync

# Mirror to a specific vault directory
docker run --rm -v /path/to/your/db:/data -v /path/to/your/vault:/vault livesync-cli mirror /vault

# List files in the local database
docker run --rm -v /path/to/your/db:/data livesync-cli ls
```

The database directory is mounted at `/data` by default. Override with `-e LIVESYNC_DB_PATH=/other/path`.

#### P2P (WebRTC) and Docker networking

The P2P replicator (`p2p-host`, `p2p-sync`, `p2p-peers`) uses WebRTC and generates
three kinds of ICE candidates. The default Docker bridge network affects which
candidates are usable:

| Candidate type | Description                        | Bridge network             |
| -------------- | ---------------------------------- | -------------------------- |
| `host`         | Container bridge IP (`172.17.x.x`) | Unreachable from LAN peers |
| `srflx`        | Host public IP via STUN reflection | Works over the internet    |
| `relay`        | Traffic relayed via TURN server    | Always reachable           |

**LAN P2P on Linux** — use `--network host` so that the real host IP is
advertised as the `host` candidate:

```bash
docker run --rm --network host -v /path/to/your/vault:/data livesync-cli p2p-host
```

Note: also fix the alias to include `--network host` if you want to use `livesync-cli` for P2P commands.

> `--network host` is not available on Docker Desktop for macOS or Windows.

**LAN P2P on macOS / Windows Docker Desktop** — configure a TURN server in the
settings file (`P2P_turnServers`, `P2P_turnUsername`, `P2P_turnCredential`).
All P2P traffic will then be relayed through the TURN server, bypassing the
bridge-network limitation.

**Internet P2P** — the default bridge network is sufficient. The `srflx`
candidate carries the host's public IP and peers can connect normally.

**CouchDB sync only (no P2P)** — no special network configuration is required.


### Adding `livesync-cli` alias

To use the `livesync-cli` command globally, you can add an alias to your shell configuration file (e.g., `.zshrc` or `.bashrc`).

If you are using `npm run`, add the following line:

```bash
alias livesync-cli='npm run --silent --prefix /path/to/repository/src/apps/cli cli --'
# or
alias livesync-cli="npm run --silent --prefix $PWD cli --"
```

Alternatively, if you want to use the built executable directly:

```bash
alias livesync-cli='node /path/to/repository/src/apps/cli/dist/index.cjs'
or
alias livesync-cli="node $PWD/dist/index.cjs"
```

If you prefer using Docker:

```bash
alias livesync-cli='docker run --rm -v /path/to/your/db:/data livesync-cli'
```

After adding the alias, restart your shell or run `source ~/.zshrc` (or `.bashrc`).

## Usage

### Basic Usage

As you know, the CLI is designed to be used in a headless environment. Hence all operations are performed against a local vault directory and a settings file. Here are some example commands:

```bash
# Sync local database with CouchDB (no files will be changed).
livesync-cli /path/to/your-local-database --settings /path/to/settings.json sync

# Push files to local database
livesync-cli /path/to/your-local-database --settings /path/to/settings.json push /your/storage/file.md /vault/path/file.md

# Pull files from local database
livesync-cli /path/to/your-local-database --settings /path/to/settings.json pull /vault/path/file.md /your/storage/file.md

# Verbose logging
livesync-cli /path/to/your-local-database --settings /path/to/settings.json --verbose

# Apply setup URI to settings file (settings only; does not run synchronisation)
livesync-cli /path/to/your-local-database --settings /path/to/settings.json setup "obsidian://setuplivesync?settings=..."

# Put text from stdin into local database
echo "Hello from stdin" | livesync-cli /path/to/your-local-database --settings /path/to/settings.json put /vault/path/file.md

# Output a file from local database to stdout
livesync-cli /path/to/your-local-database --settings /path/to/settings.json cat /vault/path/file.md

# Output a specific revision of a file from local database
livesync-cli /path/to/your-local-database --settings /path/to/settings.json cat-rev /vault/path/file.md 3-abcdef

# Pull a specific revision of a file from local database to local storage
livesync-cli /path/to/your-local-database --settings /path/to/settings.json pull-rev /vault/path/file.md /your/storage/file.old.md 3-abcdef

# List files in local database
livesync-cli /path/to/your-local-database --settings /path/to/settings.json ls /vault/path/

# Show metadata for a file in local database
livesync-cli /path/to/your-local-database --settings /path/to/settings.json info /vault/path/file.md

# Mark a file as deleted in local database
livesync-cli /path/to/your-local-database --settings /path/to/settings.json rm /vault/path/file.md

# Resolve conflict by keeping a specific revision
livesync-cli /path/to/your-local-database --settings /path/to/settings.json resolve /vault/path/file.md 3-abcdef
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
  livesync-cli <database-path> [options] <command> [command-args]
  livesync-cli init-settings [path]

Arguments:
  database-path           Path to the local database directory (required except for init-settings)

Options:
  --settings, -s <path>   Path to settings file (default: .livesync/settings.json in local database directory)
  --force, -f             Overwrite existing file on init-settings
  --verbose, -v           Enable verbose logging
  --debug, -d             Enable debug logging (includes verbose)
  --interval <N>, -i <N>  (daemon only) Poll CouchDB every N seconds instead of using the _changes feed
  --help, -h              Show this help message

Commands:
  daemon                  (default) Run mirror scan then continuously sync CouchDB <-> local filesystem
  init-settings [path]    Create settings JSON from DEFAULT_SETTINGS
  sync                    Run one replication cycle and exit
  p2p-peers <timeout>     Show discovered peers as [peer]<TAB><peer-id><TAB><peer-name>
  p2p-sync <peer> <timeout>   Synchronise with specified peer-id or peer-name
  p2p-host                Start P2P host mode and wait until interrupted (Ctrl+C)
  push <src> <dst>        Push local file <src> into local database path <dst>
  pull <src> <dst>        Pull file <src> from local database into local file <dst>
  pull-rev <src> <dst> <rev>   Pull specific revision <rev> into local file <dst>
  setup <setupURI>        Apply setup URI to settings file
  put <dst>               Read text from standard input and write to local database path <dst>
  cat <src>               Write latest file content from local database to standard output
  cat-rev <src> <rev>     Write specific revision <rev> content from local database to standard output
  ls [prefix]             List files as path<TAB>size<TAB>mtime<TAB>revision[*]
  info <path>             Show file metadata including current and past revisions, conflicts, and chunk list
  rm <path>               Mark file as deleted in local database
  resolve <path> <rev>    Resolve conflict by keeping the specified revision
  mirror [vaultPath]      Mirror database contents to the local file system (vaultPath defaults to database-path)
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

   | Group                         | Condition                    | Action                                                                                                                                                                                                                                              |
   | ----------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **UPDATE DATABASE**           | File exists in storage only  | Store the file into the local database.                                                                                                                                                                                                             |
   | **UPDATE STORAGE**            | File exists in database only | If the entry is active (not deleted) and not conflicted, restore the file from the database to storage. Deleted entries and conflicted entries are skipped.                                                                                         |
   | **SYNC DATABASE AND STORAGE** | File exists in both          | Compare `mtime` freshness. If storage is newer → write to database (`STORAGE → DB`). If database is newer → restore to storage (`STORAGE ← DB`). If equal → do nothing. Conflicted documents and files exceeding the size limit are always skipped. |

6. **Initialisation flag** — On the very first successful run, writes `initialized = true` to the key-value database so that subsequent runs can restore state in step 2.

Note: `mirror` does not respect file deletions. If a file is deleted in storage, it will be restored on the next `mirror` run. To delete a file, use the `rm` command instead. This is a little inconvenient, but it is intentional behaviour (if we handle this automatically in `mirror`, we should be against a ton of edge cases).

##### daemon

`daemon` is the default command when no command is specified. It runs an initial mirror scan and then continuously syncs changes in both directions:

- **CouchDB → local filesystem**: via the `_changes` feed (LiveSync mode, default) or periodic polling (`--interval N`).
- **local filesystem → CouchDB**: via chokidar file watching. Any file created, modified, or deleted in the vault directory is pushed to CouchDB.

In **LiveSync mode** the `_changes` feed delivers remote changes as they arrive, with sub-second latency. In **polling mode** (`--interval N`) the CLI polls CouchDB every N seconds. Use polling mode if your CouchDB instance does not support long-lived HTTP connections, or if you need predictable network usage.

The daemon exits cleanly on `SIGINT` or `SIGTERM`.

```bash
# LiveSync mode (default — _changes feed, near-real-time)
livesync-cli /path/to/vault

# Polling mode — poll every 60 seconds
livesync-cli /path/to/vault --interval 60
```

### .livesync/ignore

Place a `.livesync/ignore` file in your vault root to exclude files from sync in both directions (local → CouchDB and CouchDB → local).

**Format:**

- Lines beginning with `#` are comments.
- Blank lines are ignored.
- All other lines are [minimatch](https://github.com/isaacs/minimatch) glob patterns, relative to the vault root.
- The directive `import: .gitignore` (exactly this string) reads `.gitignore` from the vault root and merges its non-comment, non-blank lines into the ignore rules.
- Negation patterns (lines starting with `!`) are not supported and will cause an error on load.

**Example `.livesync/ignore`:**

```
# Ignore temporary files
*.tmp
*.swp

# Ignore build output
build/
dist/

# Merge patterns from .gitignore
import: .gitignore
```

Patterns apply in both directions: the chokidar watcher will not emit events for matched files, and the `isTargetFile` filter will exclude them from CouchDB → local sync.

Changes to this file require a daemon restart to take effect.

### Systemd Installation

The `deploy/` directory contains a systemd unit template and an install script.

**Automated install (user service, recommended):**

```bash
bash src/apps/cli/deploy/install.sh --vault /path/to/vault
```

**With polling interval:**

```bash
bash src/apps/cli/deploy/install.sh --vault /path/to/vault --interval 60
```

**System-wide install** (requires root / sudo for `/etc/systemd/system/`):

```bash
bash src/apps/cli/deploy/install.sh --system --vault /path/to/vault
```

The script:
1. Builds the CLI (`npm install` + `npm run build`).
2. Installs the binary to `~/.local/bin/livesync-cli` (user) or `/usr/local/bin/livesync-cli` (system).
3. Writes the unit file to `~/.config/systemd/user/livesync-cli.service` (user) or `/etc/systemd/system/livesync-cli.service` (system).
4. Runs `systemctl [--user] daemon-reload && systemctl [--user] enable --now livesync-cli`.

**Manual setup** — if you prefer to manage the unit yourself, copy `deploy/livesync-cli.service`, replace `LIVESYNC_BIN` and `LIVESYNC_VAULT_PATH` with the actual binary path and vault path, then install to the appropriate systemd directory.

### Planned options:

- `--immediate`: Perform sync after the command (e.g. `push`, `pull`, `put`, `rm`).
- `serve`: Start CLI in server mode, exposing REST APIs for remote, and batch operations.
- `cause-conflicted <vaultPath>`: Mark a file as conflicted without changing its content, to trigger conflict resolution in Obsidian.

## Use Cases

### 1. Bootstrap a new headless vault

Create default settings, apply a setup URI, then run one sync cycle.

```bash
livesync-cli -- init-settings /data/livesync-settings.json
printf '%s\n' "$SETUP_PASSPHRASE" | livesync-cli -- /data/vault --settings /data/livesync-settings.json setup "$SETUP_URI"
livesync-cli -- /data/vault --settings /data/livesync-settings.json sync
```

### 2. Scripted import and export

Push local files into the database from automation, and pull them back for export or backup.

```bash
livesync-cli -- /data/vault --settings /data/livesync-settings.json push ./note.md notes/note.md
livesync-cli -- /data/vault --settings /data/livesync-settings.json pull notes/note.md ./exports/note.md
```

### 3. Revision inspection and restore

List metadata, find an older revision, then restore it by content (`cat-rev`) or file output (`pull-rev`).

```bash
livesync-cli -- /data/vault --settings /data/livesync-settings.json info notes/note.md
livesync-cli -- /data/vault --settings /data/livesync-settings.json cat-rev notes/note.md 3-abcdef
livesync-cli -- /data/vault --settings /data/livesync-settings.json pull-rev notes/note.md ./restore/note.old.md 3-abcdef
```

### 4. Conflict and cleanup workflow

Inspect conflicted revisions, resolve by keeping one revision, then delete obsolete files.

```bash
livesync-cli -- /data/vault --settings /data/livesync-settings.json info notes/note.md
livesync-cli -- /data/vault --settings /data/livesync-settings.json resolve notes/note.md 3-abcdef
livesync-cli -- /data/vault --settings /data/livesync-settings.json rm notes/obsolete.md
```

### 5. CI smoke test for content round-trip

Validate that `put`/`cat` is behaving as expected in a pipeline.

```bash
echo "hello-ci" | livesync-cli -- /data/vault --settings /data/livesync-settings.json put ci/test.md
livesync-cli -- /data/vault --settings /data/livesync-settings.json cat ci/test.md
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
