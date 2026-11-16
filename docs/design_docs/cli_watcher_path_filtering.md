---
date: 2026-11-12
commonlib-version: "0.4.3"
self-hosted-livesync-version: "1.0.49"
status: accepted
---

# CLI watcher path filtering

Implementation note: the correction is included in Self-hosted LiveSync
`1.0.50` and has been validated locally and in CI. The reviewed baseline remains
Self-hosted LiveSync
`78ebc2d2` and Commonlib `0.4.3`. The original failure was reproduced against
Self-hosted LiveSync `71893f2e` (`1.0.47`) with Commonlib `0.4.1` and Chokidar `6.0.0`.
Reporter confirmation remains pending.

Integration note: daemon monitoring now borrows delivery from the shared
[file-name source](file_path_index.md). The source observes supported names
before applying `isIgnoredFilePath` to synchronisation delivery, using the same
`CLIPathFilterOptions` as logical target checks. Ignore rules and database
protection must not narrow its collision inventory. The original dates and
baseline above, and the historical verification below, remain unchanged.

## Problem and required behaviour

[#1340](https://github.com/vrtmrz/obsidian-livesync/issues/1340) reports that new
Vault files never reach the remote after Fetch. In the focused reproduction,
the real CLI watch adapter accepts a normal Vault and a visible symlink to a
hidden-parent Vault, but emits no new-file event after that symlink is resolved
to its physical path. The file exists, watcher readiness completes, and no
watcher diagnostic is reported. This reproduces the monitoring failure without
Fetch, Metadata collisions, or a negative timeout.

Before this correction, the watcher applied its default exclusion expressions
to the full filesystem path. A dot-prefixed directory above the selected Vault
could therefore exclude the entire watch root.

The selected Vault must remain watchable regardless of the spelling of its root
or parent directories. Default exclusions and user ignore rules must apply to
entries within that Vault. The correction must preserve the canonical physical
root used by [CLI database continuity](cli_database_continuity.md).

## Scope

The implementation uses one CLI-local refinement, `VaultRelativePath`, and one
conversion boundary. It shares the watcher and logical target exclusion policy and adds a runtime
compatibility option, while retaining `main.ts` path resolution, database
selection, runtime scopes, and Commonlib APIs. The integrated shared source
uses the supported storage scope: the selected root is still canonicalised, and
descendant symlinks are not followed because storage operations reject them.

The type expresses a checked lexical path relative to the supplied Vault root.
It does not establish filesystem existence, Unicode or case resolution,
physical containment through descendant symlinks, or continued validity after
filesystem changes. It does not encode which Vault instance produced the value.

## Type and conversion boundary

The CLI-local `src/apps/cli/cliPathFilter.ts` retains `isHiddenPath(string)`
for its existing callers and provides these internal CLI contracts:

```ts
import type { FilePath } from "@vrtmrz/livesync-commonlib/storage";
import type { IgnoreRules } from "./serviceModules/IgnoreRules";

declare const vaultRelativePathBrand: unique symbol;

export type VaultRelativePath = FilePath & {
    readonly [vaultRelativePathBrand]: true;
};

export interface CLIPathFilterOptions {
    readonly includeDbLikeDirs?: boolean;
    readonly databaseRoot?: VaultRelativePath;
}

export declare function toVaultRelativePath(vaultRoot: string, candidatePath: string): VaultRelativePath | undefined;

export declare function isIgnoredFilePath(
    relativePath: FilePath,
    rules?: Pick<IgnoreRules, "shouldIgnore">,
    options?: CLIPathFilterOptions
): boolean;

export declare function isIgnoredVaultPath(
    relativePath: VaultRelativePath,
    rules?: Pick<IgnoreRules, "shouldIgnore">,
    options?: CLIPathFilterOptions
): boolean;
```

Use a distinct local symbol to refine `FilePath`. Both the existing
`FilePath` and a new `TaggedType<string, "...">` use the same underlying tag
property; assigning a different tag to `FilePath` would conflict with its
existing tag. The refinement above remains assignable to the existing
`NodeFile.path` and `NodeFolder.path` contracts without another assertion.

Only `toVaultRelativePath` creates the local refinement:

1. Require absolute native filesystem paths for both inputs. The caller retains
   the root obtained by the existing start-up `fs.realpath` call.
2. Compute `path.relative(vaultRoot, candidatePath)`, using the existing native
   `path` implementation.
3. Retain the CLI's existing conversion of separators to `/`.
4. Pass the result through Commonlib's `parseFilePath`. It accepts the empty
   root path and rejects absolute, drive-qualified, backslash, and traversal
   input without changing spelling.
5. Return the validated `FilePath` with the additional local brand. Return
   `undefined` for invalid input or a result outside the lexical root.

Keep any catch around the pure parser call only. This conversion performs no
filesystem reads, existence checks, Unicode conversion, or case conversion.
The parser is responsible for relative-path syntax; do not duplicate its
validation expressions. Different-drive and sibling-prefix cases must fail
validation rather than acquire the brand.

A deleted file still has a convertible event path. Do not call `realpath` or
`stat` for each event. The canonical root is retained as a separate value;
computing a relative path does not replace it.

## Exclusion policy

`isIgnoredFilePath` owns the policy for validated logical paths.
`isIgnoredVaultPath` retains the narrower watcher contract and delegates to it.
`main.ts` validates logical target paths with `parseFilePath` before applying the
same policy. Its default and user-rule handler priorities remain unchanged.

| Input or condition                                                | Decision                                         |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| Empty string, denoting the selected root                          | Keep the root watchable                          |
| A dot-prefixed component within the Vault                         | Exclude                                          |
| A DB-like entry directly within the configured database directory | Exclude, including with the compatibility option |
| Any DB-like component elsewhere, with the default options         | Exclude                                          |
| An entry matched by `IgnoreRules`                                 | Exclude, including with the compatibility option |
| Any other valid entry                                             | Monitor or admit as a target                     |

DB-like names end in Commonlib's `SuffixDatabaseName` (`-livesync-v2`) or contain
`-livesync-v2-mrview-`, the prefix PouchDB uses for dependent view databases.
The CLI's PouchDB factory produces both primary and view directories; a primary
name-only check misses the latter. Previous database suffixes remain protected
in the configured database directory.

The database root is converted from the canonical `databasePath` to a
`VaultRelativePath`. When it is outside the Vault, it creates no protected
storage namespace inside the Vault. When both roots coincide, the empty string
identifies that namespace. Only its direct DB-like entries and their descendants
receive unconditional protection; the database root itself remains traversable.
This is a lexical ownership rule, not inspection of arbitrary directory contents.

### Compatibility option

`--include-db-like-dirs` permits ordinary paths otherwise excluded only by the
DB-like naming rule. It applies consistently to initial scans, live events, and
logical target checks. Hidden entries, custom ignore rules, and DB-like entries
in the configured database storage namespace remain excluded.

For example, with both the database and Vault rooted at `<vault>`:

| Vault-relative path                      | Default | With the option |
| ---------------------------------------- | ------- | --------------- |
| `local-livesync-v2/CURRENT`              | Exclude | Exclude         |
| `local-livesync-v2-mrview-index/CURRENT` | Exclude | Exclude         |
| `notes/archive-livesync-v2/note.md`      | Exclude | Admit           |
| `.livesync/settings.json`                | Exclude | Exclude         |

With the database root at `<vault>/state`, the first two protected entries are
under `state/` instead. With a database root outside the Vault, matching user
directories in the Vault can be admitted at any depth by the option.

The option is runtime-only and must be supplied on each invocation that needs
it. It adds no stored setting, migration, or ownership ledger. The policy cannot
identify an unrelated database merely from its contents; an opt-in can admit
such directories outside the configured storage namespace. The option does not
add support for descendant symlinks.

Reuse `isHiddenPath` and `IgnoreRules.shouldIgnore`; a hidden parent outside the
selected Vault must not affect these decisions. A user rule can exclude every
entry while the watcher root remains watchable.

## Watcher integration and rejected candidates

For the standalone adapter fallback, the Chokidar `ignored` callback converts
its candidate before calling the typed policy. If conversion returns `undefined`, the candidate is excluded without
throwing or reporting an error. Chokidar may evaluate ancestors of its root;
version `6.0.0` separately keeps root ancestors watchable. Do not manufacture a
Vault-relative value for those paths.

Bind conversion to the adapter's stored `basePath`: watch callbacks supply only
the candidate path to an adapter-local wrapper. Keep the pure two-input
converter available for unit tests, and do not derive a new root from an event.

Use the same converter in the adapter's file and folder event conversion, so
those paths are produced at the same boundary. A successful value flows into
the existing `FilePath` fields directly. Preserve folder-root event semantics.

An emitted event that cannot be converted is unexpected: use the existing CLI
diagnostic reporter and omit that event. It must not create a pending storage
operation, reset state, terminate the daemon, or stop unrelated valid events.
Expected ancestor candidates in the `ignored` callback are not diagnostics.
Diagnostics must describe the rejected path and the selected root without
claiming that all monitoring has stopped.

The standalone adapter uses the typed policy rather than calling its
string-based exclusion helpers directly. Do not add assertions at callback call
sites to bypass conversion.

In the daemon composition, the shared source owns the native watcher. Its
observation exclusions follow the supported name-listing scope. The event-manager
adapter borrows delivery from that source, and `isIgnoredFilePath` applies only
after name observation. `CLIServiceModules` passes the runtime options through
`FileAccessCLI` into the source, so initial logical checks and subsequent delivery
retain the same database protection and compatibility option.

## Compatibility and bounded alternatives

The canonical root continues to identify scanner state, reflection provenance,
storage-event snapshots, and replication checkpoints. This correction adds no
persistent state or migration. Existing legacy-state admission still applies
when upgrading an older database.

Keeping an unresolved symlink name only for watching would leave direct hidden
roots broken and introduce another root representation. Removing `realpath`
would also affect runtime ownership. Neither is required by this design.

Commonlib's `StoragePath` includes resolved physical spelling, which this lexical
converter does not prove. Use its existing `FilePath` and `parseFilePath`
contracts instead of asserting `StoragePath`. A complete absolute/canonical
path type system and per-Vault generic types remain outside this correction.

Metadata identity collisions, existing `document-id-mismatch` entries, and
negative timeout warnings remain separate investigations. Monitoring recovery
must not be described as repairing those entries.

## Implementation and verification

| Location                                                 | Responsibility                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/apps/cli/cliPathFilter.ts`                          | The refinement, checked conversion, and typed exclusion policy         |
| `src/apps/cli/managers/CLIStorageEventManagerAdapter.ts` | Connect ignored candidates and emitted events to that boundary         |
| CLI path-filter and watcher unit tests                   | Conversion, policy, type compatibility, and event conversion           |
| Existing real-filesystem watcher tests                   | Preserve the original failure and verify actual events                 |
| A focused `test/e2e-cli` scenario                        | Fetch, live daemon monitoring, remote contents, and restart continuity |

Acceptance requires the following evidence:

- Port the failing `1.0.47` scenario to the implementation baseline and confirm
  failure for the missing CREATE event before changing production code.
- Normal and hidden-parent roots, visible symlinks, and root names resembling
  internal database directories must report create, modify, and delete events
  with correct relative paths.
- Dot-prefixed entries, internal databases, custom ignore patterns, and existing
  supported storage scope must retain their exclusions. Exercise Chokidar's ancestor
  candidates as well as the root itself.
- Cover invalid or relative inputs, `..`, sibling prefixes, platform-native
  separators, and different drives where supported. Rejected emitted events
  must not prevent later valid events.
- Type checks must accept `VaultRelativePath` as `FilePath` and reject both a
  plain string and an unrefined `FilePath` at the typed policy. Vitest execution
  alone does not perform this check; run the CLI TypeScript check explicitly.
- A disposable CouchDB test must complete Fetch, start the real daemon, and
  verify created and edited contents and deletion on the remote. Restart through
  an alias and its physical path and verify the same database selection and
  runtime scope. The existing `test-daemon-linux.sh` mirror tests alone do not
  exercise this live monitoring boundary.
- Complete the repository checks, unit tests, production build, CLI check and
  build, and the focused CLI E2E required by the implementation. Run broad
  validation serially with the configured heap limit.

Describe local verification and reporter confirmation separately when publishing
the correction. Verify default/option parity and protected primary, old, and
derived databases when changing the shared policy.
The original focused reproduction establishes the failure. Evidence for the
correction, including the CouchDB test, is recorded below.

## Local verification and remaining coverage

The current-main regression first failed for hidden roots and parents and for
roots or parents matching the internal-database exclusion. Normal roots and
descendant symlinks remained observable through the standalone watcher. That
result did not establish supported synchronisation through descendant symlinks:
the existing storage adapter already rejected those paths. After the correction, the same
real-filesystem cases pass for creation, modification, and deletion. Hidden
entries, internal databases, and user patterns remain excluded.

Local verification used Linux ARM64, Node.js 26.13.0, Commonlib 0.4.3, and
Chokidar 6.0.0. The repository checks, full unit suite, CLI and production
builds, E2E TypeScript check, and iOS bundle compatibility check passed.

The disposable CouchDB test uses E2EE, online Chunk retrieval, and an independent
replicating observer. It verifies Fetch, live create/modify/delete, exclusions
in the observer database, and restart from the symlink to the physical path
with unchanged database selection and runtime scope.

Baseline current Metadata identity and content remain unchanged on both peers.
The source retains its original revision body, and CouchDB retains that
revision in the baseline document's ancestry. The test does not require peers
to download unavailable historical revision bodies.

The Windows-only different-drive case was skipped on Linux; this local run
does not establish Windows filesystem behaviour. Reporter confirmation and
investigation of the separate Metadata identity and timeout warnings remain
outstanding.

### Shared-policy update

The shared policy and `--include-db-like-dirs` extend the initial watcher-only
correction. Before implementation, a bootstrap regression demonstrated that a
nested DB-like path passed the logical target filter while the watcher excluded
it. A real PouchDB inventory also demonstrated the separate view directory.
The updated tests cover these cases and the compatibility option. Local
verification passed the CLI TypeScript check, repository checks, full unit
suite (2,157 passed and two skipped), CLI and production builds, E2E TypeScript
check, and the encrypted CouchDB scenario. The latter confirms default exclusion
from the independent observer database, then initial contents, modifications,
and deletion after restarting both clients with the option. Bootstrap tests
also create a real PouchDB view index and verify that current, previous, and
view databases remain excluded with the option.

The two skipped unit cases are platform-dependent: a Windows different-drive
case and an existing host-filesystem alias case. Windows runtime behaviour and
reporter confirmation remain unverified. The correction is included in `1.0.50`.

### Shared file-name source integration

Real-filesystem root, create/modify/delete, exclusion, and burst scenarios now
exercise the shared source borrowed by the event-manager adapter. Root symlinks
are canonicalised before composition. A descendant-symlink fixture checks both
its absence from delivered child events and name listings and the existing
storage rejection.

A service-composition regression first demonstrated that the shared source lost
`CLIPathFilterOptions`: an opted-in ordinary directory remained excluded, while
PouchDB view directories reached event delivery. The correction reuses
`isIgnoredFilePath` after observation. Tests cover the default policy, the runtime
option, separate and shared database roots, and collision candidates retained
from ignored names. This focused evidence does not replace the required packed
dependency, broad, or real-runtime validation for the combined change.
