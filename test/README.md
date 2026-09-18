# Test procedures

Run the commands below from the repository root. Test ownership and source layout are described in the [development guide](../devs.md#testing-infrastructure).

## npm 10 clean-installation check

Run this check after changing `package.json`, a workspace manifest, or `package-lock.json`, including a Commonlib dependency update. A successful installation with the npm version bundled with Node.js does not prove that npm 10 accepts the lockfile.

The following sequence matches the installation steps in [unit-ci](../.github/workflows/unit-ci.yml). Use Node.js 24, as configured in that workflow:

```bash
npx --yes npm@10.9.4 ci --ignore-scripts --no-audit --no-fund
npm ci
```

Both commands must complete successfully without changing the lockfile. The first checks npm 10 lockfile compatibility; the second prepares the normal development installation, including lifecycle scripts, for the source checks and tests below. Keep the pinned npm version and command here aligned with CI. This project-side check does not establish the runtime version used by the external Community Review service or replace its authenticated review result.

If Community Review reports widespread TypeScript `error` types across unrelated external packages, first confirm that dependency installation completed successfully. An installation failure can leave external types unresolved and produce misleading source warnings.

## Source and unit checks

Run broad checks sequentially. These examples bound the Node.js heap and Vitest workers for machines with limited memory:

```bash
NODE_OPTIONS=--max-old-space-size=3072 npm run check
NODE_OPTIONS=--max-old-space-size=3072 npm run test:unit -- --maxWorkers=1
```

`npm run check` includes TypeScript, ESLint, the Community rules, Svelte checks, a production build, and bundle compatibility checks. Inspect installation and source-check failures before interpreting later test results. Add the relevant service or runtime suite for the boundary changed:

| Boundary | Procedure |
| --- | --- |
| Multiple-device file conflicts and stale-file protection | [CouchDB procedure below](#multiple-device-conflict-regression-tests) |
| Obsidian startup, file watching, persistence, and UI | [Real Obsidian E2E](e2e-obsidian/README.md) |
| CLI subprocesses, filesystem workflows, and P2P | [CLI Deno tests](../src/apps/cli/testdeno/test_dev_deno.md) and [test authoring](../src/apps/cli/testdeno/CONTRIBUTING_TESTS.md) |
| WebApp, WebPeer, and browser interoperability | [Browser application tests](browser-apps/README.md) |

## Community Review checks and CI confirmation

Before requesting review or merging source or dependency changes, run the project-side Community checks after dependency installation:

```bash
NODE_OPTIONS=--max-old-space-size=3072 npm run lint:community
NODE_OPTIONS=--max-old-space-size=3072 npm run lint:community:tools
```

The source check uses the official `eslint-plugin-obsidianmd` rules with the repository's [Community configuration](../eslint.community.config.mjs). Run it without `--quiet` so warnings remain visible. Review new warnings as well as errors, and distinguish existing warnings from those introduced by the change. A successful exit alone does not establish that the source has no warnings. The tooling check requires zero warnings.

The [unit-ci workflow](../.github/workflows/unit-ci.yml), in its `Unit Tests` job, runs the npm 10 installation check and then `npm run check`. That script includes `lint:community` and `lint:community:tools`, so source warnings are visible in the CI log as well as during local checks. Source errors fail the gate; source warnings remain visible for review without failing it. The explicit commands above can run these checks independently of the full source-check sequence.

After pushing, confirm that the `Unit Tests` job passed for the exact commit being reviewed, including its `Verify clean installation with npm 10` and `Run source checks` steps. For service-backed changes, also confirm the integration-test job and the relevant runtime checks. A successful run for an earlier commit does not validate later changes.

The local checks and CI use the project's installed rule versions and configured file scope. Record the authenticated external Community Review result separately when that review is required; the project-side checks do not replace it. When the external review reports additional findings, retain its relevant output and investigate differences in installation, type resolution, scope, or rules.

## CLI mirror regression tests

Run the native CLI subprocess suite after building the CLI:

```bash
NODE_OPTIONS=--max-old-space-size=3072 npm run build --workspace self-hosted-livesync-cli
cd src/apps/cli/testdeno
deno test -A --no-check test-mirror.ts
```

The expected result is seven passing steps. These cover storage-only and database-only files, database deletion, an ordinary local edit, incoming database content, an omitted Vault path, and local content with unknown provenance.

For an ordinary local edit, first reflect the database content into the Vault, confirm its bytes, and then edit that file. The next `mirror` must store the edit without a conflict. For unknown provenance, use `put` to seed only the database and independently create different local content with a newer modification time. The next `mirror` must preserve two independent non-deleted revisions. Read both with `cat-rev`, submit the same local bytes again to check that no additional revision appears, and use `resolve` to select the local content. Confirm that the conflict is gone and the selected content is reflected into the Vault.

`put` deliberately bypasses file provenance, whereas `push` records it. Substituting one for the other changes the scenario. The tests enable `writeDocumentsIfConflicted` for incoming reflection; this setting does not authorise an ordinary save to replace unrelated database content or resolve the conflict. Do not assume which independent root PouchDB selects as the winner.

The [CLI Docker workflow](../.github/workflows/cli-docker.yml) runs the corresponding Bash suite. From the repository root, build and check that path with:

```bash
NODE_OPTIONS=--max-old-space-size=3072 npm run build:docker --workspace self-hosted-livesync-cli
npm run test:e2e:docker:mirror --workspace self-hosted-livesync-cli
```

The expected result is `PASS=7 FAIL=0`. These mirror suites use temporary local databases and need no CouchDB service. The complete `test:e2e:docker:all` command also runs the other Docker CLI suites and manages a disposable CouchDB fixture; use it to check the full Docker CI gate. Keep the ordinary-edit and unknown-provenance scenarios aligned between the Deno and Bash suites.

## Multiple-device conflict regression tests

### Preparation and execution

The suite is [FileHandler.multidevice.integration.spec.ts](../src/serviceModules/FileHandler.multidevice.integration.spec.ts). It exercises the installed Commonlib package through LiveSync's shared file handler, the CLI `resolve` command dispatcher, and the shared conflict-resolution operations.

Use a disposable CouchDB service. To use the repository's Docker fixture, set the following values in `.test.env` and ensure `.env` exists. The fixture uses the container name `couchdb-test` and host port `5989`:

```dotenv
hostname=http://127.0.0.1:5989/
username=admin
password=testpassword
```

Start the fixture, then run the focused suite:

```bash
npm run test:docker-couchdb:start
NODE_OPTIONS=--max-old-space-size=3072 npm run test:integration -- src/serviceModules/FileHandler.multidevice.integration.spec.ts --maxWorkers=1
```

The expected result is five passing tests. Each case creates a uniquely named remote database and removes it during teardown. Stop the fixture after the run, including when the test command fails:

```bash
npm run test:docker-couchdb:stop
```

When using an already running disposable CouchDB service, configure its endpoint and credentials in `.test.env` and run only the test command. The start and stop commands manage the repository's Docker fixture. This suite needs no Object Storage, P2P relay, or Obsidian application. It is also discovered by the existing integration-test CI job.

### Scenarios and expected results

Each simulated device owns a separate real PouchDB database, `LiveSyncLocalDB` managers, file content, and provenance record. Devices first share one revision, edit while disconnected, and then replicate their Metadata and Chunks through real CouchDB. File reflection is deliberately delayed after replication to reproduce the interval in which the database has advanced but the file still contains older content. All edits use equal modification times, so the tests require revision and content checks rather than timestamp ordering.

| Case | Setup and action | Required result |
| --- | --- | --- |
| Three editing devices | Replicate three conflicting edits, reprocess unchanged files, select a non-winning revision through CLI `resolve`, and replicate the resolution before reprocessing the other files. | All three contents are initially readable on every replica. Unchanged saves make no database writes. After resolution, all files and replicas converge to the selected revision without creating revisions or restoring conflicts. |
| Four editing devices | Repeat the same sequence with four independently edited branches. | All four contents are initially preserved, and the same unchanged-save and convergence guarantees hold. |
| A genuine edit on a losing device | After three-way resolution reaches its DB, a device adds content to its still-unreflected losing file, then saves and replicates it. | The new revision extends that device's recorded branch. The selected result and the new edit remain readable on every replica. |
| Missing provenance | After four-way resolution, remove a losing device's provenance record and set its file to the original historical ancestor's content. Save, remove provenance again, and repeat the save. | The file becomes one fresh independent root, distinct from the historical root. Both contents remain readable after replication, and repeated saves create no duplicates. CLI `resolve` can select the independent root and propagate its resolution. |
| Compacted base | After four-way resolution, compact a losing device's local DB and confirm that its recorded revision body is unavailable. Save the remaining file, then repeat after removing provenance. | The file is preserved as one independent conflict rather than discarded. Both contents remain readable on every replica, repeated saves create no duplicates, and CLI `resolve` can select the independent root and propagate its resolution. |

### Coverage boundaries

This is a service integration test, not a CLI subprocess or Obsidian runtime test. The file and provenance stores are in-memory fixtures; automatic conflict callbacks are observed without running interactive or automatic merge policies. PouchDB revision creation, chunk storage and retrieval, local compaction, CouchDB replication, the CLI command dispatcher, and its resolution operations are real.

Use the CLI and real-Obsidian procedures linked above for argument parsing, persistent host stores, file watchers, and dialogues. In particular, the real-Obsidian `stale-file-restart` scenario exercises persisted pending events and restart, and `folder-batch` exercises bulk Vault rename and deletion. These scenarios do not simulate a mobile operating system suspending the application.
