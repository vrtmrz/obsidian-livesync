# Review Harness

The Review Harness is an opt-in, real-device review tool for Self-hosted LiveSync maintainers. It replaces the disabled legacy Test Pane with fixed, auditable scenarios, a device-local one-shot continuation, and a Markdown report which can be pasted into a pull request.

It supplies supporting evidence rather than a release gate by itself. Unit, integration, Compose, CLI E2E, and real-Obsidian E2E remain authoritative for the boundaries they own.

## Enabling the Harness

1. Use a dedicated test Vault.
2. Enable **Power users → Enable Developers' Debug Tools**.
3. Restart Obsidian.
4. Run **Self-hosted LiveSync: Open review harness** from the command palette.

The command and view are registered only when developer tools are enabled. Disabling the setting and restarting removes the entry point from an ordinary user session.

## Scenarios and access

| Scenario | Mode | Access | Purpose |
| --- | --- | --- | --- |
| Settings lifecycle | Automatic | Read-only | Exposes the seven synchronisation choices as typed observations and, for a genuinely new Vault, compares the selected recommendations with Commonlib's new-Vault contract. Existing-Vault setting preservation remains an automated migration and `settings-ui` E2E responsibility. |
| Compatibility review boundary | Guided | Device-local state | Observes the current dedicated compatibility controller and opens its actual review action. The Harness does not restore Change Log acknowledgement, `lastReadUpdates`, or a separate manual Pass or Fail result. |
| ID generation performance | Automatic, individual | Read-only | Measures legacy and independent IDs using fixed in-memory inputs, including key derivation and heap samples where available. Keep Obsidian in the foreground. |
| File content hash performance | Manual | Read-only | Compares SHA-256 and xxHash64 on fixed in-memory Blob inputs. Input creation is excluded from hash timings; engine initialisation and warm-up are reported separately. |
| Vault fixture round trip | Automatic, explicit | Dedicated Vault fixtures | After explicit confirmation, creates, reads, modifies, renames, and removes one owned fixture tree. General Vault reflection remains covered by its separate real-Obsidian E2E workflow. |
| Database connection-loss diagnostic | Guided, individual-only | Dedicated database fixtures | Explicitly closes a disposable native connection, checks the retained and same-name connections, and optionally tries an explicit reopen. This is diagnostic evidence, not automatic product recovery. |
| Database background-events diagnostic | Guided, individual-only | Dedicated database fixtures | Observes registered event listeners and connection checks around an app background and foreground cycle. A run with no failure still records listener and event observations. |
| Database transaction-abort diagnostic | Manual, individual-only | Dedicated database fixtures | Observes abort events and whether a read settles on each stock adapter, then offers a manual restart after the report is copied. |

**Automatic** runs only Settings lifecycle. **Full review** visits the standard review suite, including the guided compatibility review and the two performance measurements, and asks before the Vault fixture scenario writes anything. The database diagnostics are individual-only and are excluded from both suite actions. Each scenario can also be run individually; a scenario's mode label does not by itself include it in the Automatic action.

These observations deliberately do not repeat stronger automated workflows. They exist to record which contracts the current real-device composition exposes while a maintainer reviews an immutable artefact.

### Vault fixture boundary

The Vault scenario owns only `__self-hosted-livesync-review-harness__`. It refuses to run if that path already exists, so it cannot assume ownership of a user's existing file or folder. Once it creates the root, it removes the complete owned tree from a `finally` block whether the round trip passes or fails.

The Harness accepts no path, command, code, remote configuration, or credential through plug-in data or its continuation state. New write scenarios must use a distinct fixed fixture root, describe their side effects in the interface, require confirmation, and clean up in `finally`.

### Database connection diagnostics

Each diagnostic requests confirmation before attempting to create a dedicated disposable database. It closes only its owned fixture connections; the active LiveSync database is inspected read-only, and its native handle is never exposed (only database readiness and a read-only information check are recorded).

Fixture samples and active-database samples are kept separate. Each sample records:

- its source, UTC sample time, and stage (`baseline`, `manual-check`, `after-native-close`, or `after-explicit-reopen`);
- lifecycle and background transitions as `background-transition` events;
- live listener registrations, native event-property presence, received counts, timestamps, and connection-check observations; and
- `isTrusted` on event observations (`true` for browser-delivered events, `false` for synthetic events).

The interface displays the current instruction and expected result alongside these live observations.

If the disposable fixture or native connection cannot be prepared, the Harness keeps available browser and host event observations active. Finish that run to report **Unsupported**; active-database errors do not replace missing fixture evidence or change the status, and missing native capture is not a successful database check.

#### A. Controlled connection loss

1. Open **Database connection-loss diagnostic**, select **Start diagnostic**, and confirm the dedicated fixture.
2. When the guide offers it, select **Close fixture connection**. If native capture is unavailable, finish the observation and use the report's **Unsupported** status.
3. Select **Check connections** to record how the retained handle and a same-name instance behave. If needed, select **Try explicit reopen**, then **Check connections** again.
4. Select **Finish observation** to end and clean up the diagnostic.
5. Select **Copy Markdown report** separately to copy the collected evidence.

The explicit native `close()` action is controlled test input. A **Passed** controlled result requires a failure from the disposable fixture after this action. A baseline active-database failure, or a fixture failure before the controlled close, cannot satisfy that result. An **Unsupported** fixture remains unsupported even when active-database samples report failures. The explicit native `close()` action does not emit a native `close` event, so a zero event count after this action is expected and is not evidence of an operating-system disconnect.

#### B. Database events after backgrounding on iPhone

1. Open **Database background-events diagnostic**, select **Start diagnostic**, and confirm the dedicated fixture.
2. Follow the displayed instruction: switch from Obsidian to another app briefly, then return to Obsidian.
3. Select **Check connections** to record the current connection checks and event counts.
4. Select **Finish observation**, then select **Copy Markdown report** separately.

The **Finish observation** action ends observation and cleans up the fixture; it does not copy the report.

A background run which observes no failure retains the **Not observed** result and still records listener registration, event-property presence, received counts, stages, and timestamps. However, no observed failure does not establish that a fix worked: neither diagnostic attempts automatic LiveSync recovery, and an explicit fixture reopen is recorded as a separate manual intervention rather than automatic LiveSync recovery.

#### C. Transaction abort on both adapters

This development diagnostic uses unchanged PouchDB adapters and disposable database fixtures.

1. Install the reviewed build and fully restart Obsidian before opening the Harness.
2. Run **Database transaction-abort diagnostic** individually and confirm the disposable fixtures.
3. Keep Obsidian in the foreground until the result appears. No app switch, sleep, or adapter setting change is needed; `idb` and `indexeddb` run in sequence.
4. Select **Copy Markdown report**.
5. Press **Restart Obsidian** after copying. Restart occurs only when this button is pressed; the diagnostic and report-copy action never restart the app automatically.

**Observed** means abort injection and the read state were recorded. A fulfilled, rejected, or still-pending read is evidence, rather than a required success outcome. The existing eight-second observation window reports a pending read without treating it as completed drain. The report retains event registrations, received counts including zero, and timestamps. This scenario does not reopen the fixture or attempt recovery.

For native-handle capture, the Harness temporarily wraps `indexedDB.open` and delegates every other database name unchanged. It restores that method in `finally`. The subsequent abort hook borrows methods only from the captured fixture handle, its transaction, and its object store, and restores them after the read starts. Fixture cleanup is attempted after each adapter. An unfinished Pouch operation can remain pending after cleanup, which is why the development workflow ends with the manual restart button.

This scenario observes native transaction abort and adapter completion. It does not abort the active Vault database or reproduce an iOS operating-system suspension.

## Restart continuation

The compatibility review's **Restart and return** action writes a small device-local record under `review-harness-v1`, then asks Obsidian to reload. The record permits only:

- the fixed `compatibility-review` scenario;
- the fixed `awaiting-restart` stage;
- a canonical ISO request time; and
- a request identifier derived exactly as `compatibility-review-<request time>`.

On the next settings load, the Harness deletes the record before parsing and acting on it. A valid record reopens the Harness after layout is ready and leaves the compatibility observation waiting for the reviewer. Invalid state is removed and reported as a failed continuation. The record is not stored in `data.json`, copied through a Setup URI, or synchronised to another device.

The compatibility controller does not require an Obsidian restart to acknowledge a pause. This continuation belongs to the review tool and proves its one-shot reload boundary; it is not a second compatibility lifecycle.

## Reports and privacy

**Copy Markdown report** includes:

- the plug-in and Obsidian versions;
- the platform, user agent, and viewport;
- each scenario's status and bounded summary; and
- a bounded event transcript.

The formatter has no inputs for Vault identifiers, paths, file names, file contents, remote configuration, or secrets. The report is copied locally and is never transmitted by the plug-in. Review the environment information before posting it because a user agent and viewport may identify a device or operating system.

Unexpected runtime errors are written to the local LiveSync log, while copied reports retain only a generic failure summary. This prevents an adapter error from copying a local path or file name into a pull request by accident.

## Automated real-Obsidian coverage

`npm run test:browser-database-probe` exercises the real PouchDB adapter in Chromium and WebKit: native close, stale-handle access, an independent control connection, explicit reopen with preserved fixture content and revision, and cleanup. `DATABASE_PROBE_BROWSERS=chromium` selects only Chromium when the other runtime is unavailable; that run does not establish WebKit behaviour.

`npm run test:e2e:obsidian:focused -- database-probe` builds the plug-in and checks both connection guides, the transaction-abort scenario on both adapters, mobile layout, read-only active-database checks, and copied observations in an isolated real Obsidian session. Its synthetic `pagehide` event checks the observation pipeline, not an iOS operating-system suspension.

External automation drives the stable `data-testid` attributes beginning with `review-harness-`. The dedicated workflow checks only Harness-owned behaviour: debug-only registration, consume-before-use continuation handling, fixed Vault fixture clean-up, report privacy, and mobile layout.

Compatibility dialogue behaviour and persistence belong to `test:e2e:obsidian:settings-ui`. Real P2P transport belongs to the Compose P2P suite. General Vault reflection belongs to `test:e2e:obsidian:vault-reflection`. Keeping those responsibilities separate prevents the review tool from becoming a second, weaker copy of the acceptance suite.

The mobile checks use `app.emulateMobile(true)`, a representative viewport, and safe-area and touch-target assertions. They do not claim to reproduce native operating-system overlays.
