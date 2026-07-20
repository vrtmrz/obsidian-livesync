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
| P2P composition | Automatic | Read-only | Confirms that the live P2P result resolves one replicator bound to the active Obsidian services. Peer discovery, replacement, reconnection, and transfer remain unit, CLI, and Compose E2E responsibilities. |
| Vault fixture round trip | Automatic, explicit | Dedicated Vault fixtures | After explicit confirmation, creates, reads, modifies, renames, and removes one owned fixture tree. General Vault reflection remains covered by its separate real-Obsidian E2E workflow. |

**Automatic** runs only the two read-only local observations. **Full review** also starts the guided compatibility observation and asks before the Vault fixture scenario writes anything. A scenario can also be run individually.

These observations deliberately do not repeat stronger automated workflows. They exist to record which contracts the current real-device composition exposes while a maintainer reviews an immutable artefact.

### Vault fixture boundary

The Vault scenario owns only `__self-hosted-livesync-review-harness__`. It refuses to run if that path already exists, so it cannot assume ownership of a user's existing file or folder. Once it creates the root, it removes the complete owned tree from a `finally` block whether the round trip passes or fails.

The Harness accepts no path, command, code, remote configuration, or credential through plug-in data or its continuation state. New write scenarios must use a distinct fixed fixture root, describe their side effects in the interface, require confirmation, and clean up in `finally`.

## Restart continuation

The restart action writes a small device-local record under `review-harness-v1`, then asks Obsidian to reload. The record permits only:

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

External automation drives the stable `data-testid` attributes beginning with `review-harness-`. The dedicated workflow checks only Harness-owned behaviour: debug-only registration, consume-before-use continuation handling, fixed Vault fixture clean-up, report privacy, and mobile layout.

Compatibility dialogue behaviour and persistence belong to `test:e2e:obsidian:settings-ui`. Real P2P transport belongs to the Compose P2P suite. General Vault reflection belongs to `test:e2e:obsidian:vault-reflection`. Keeping those responsibilities separate prevents the review tool from becoming a second, weaker copy of the acceptance suite.

The mobile checks use `app.emulateMobile(true)`, a representative viewport, and safe-area and touch-target assertions. They do not claim to reproduce native operating-system overlays.
