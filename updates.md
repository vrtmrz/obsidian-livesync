# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and real-device testing tools. These now form a coherent [Kit](https://github.com/vrtmrz/fancy-kit) rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through [OpenAI's Codex for Open Source](https://openai.com/form/codex-for-oss/). I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to [my dotfiles](https://github.com/vrtmrz/dotfiles).

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the [0.25 release history](docs/releases/0.25.md) and the [legacy release history](docs/releases/legacy.md).

## Unreleased

### Improved

- Clarified the 1.0 maturity of optional features. P2P and Hidden File Sync are supported opt-in features; JWT, ignore files, automatic newer-file conflict resolution, and Garbage Collection V3 remain previews; and legacy database-format settings remain compatibility paths rather than recommendations.
- Re-evaluated Data Compression. It provides a modest but measurable reduction in stored and transferred chunk data, with workload-dependent benefits and costs. See the [Data Compression specification](docs/specs_data_compression.md) for its behaviour, measurements, compatibility, and 1.0 default-setting decision.
- Classified Customisation Sync as a supported advanced workflow, backed by its maintained two-Vault real-Obsidian regression, without changing its synchronisation behaviour.
- Wizard-driven new-device and existing-device setup now reserves Rebuild or Fetch before enabling imported settings, preventing ordinary start-up work from running ahead of the selected initialisation.
- Manual onboarding now creates and selects CouchDB, Object Storage, and P2P remote profiles directly while preserving existing profiles. Current Setup URIs retain profile names and selections, while older flat settings remain supported through compatibility migration.
- P2P panes and explicit rebuild actions now use the current transport after settings or database replacement. Disconnecting leaves the LiveSync room and closes signalling relay sockets without destroying Trystero-owned shared peers.
- Self-hosted CouchDB provisioning and Setup URI generation now consume the immutable Commonlib registry package. New database provisioning records the package-owned database version, and generated CouchDB, Object Storage, and random-room P2P URIs use current new-Vault defaults and selected remote profiles instead of legacy embedded settings.

### Security

- Fly.io setup now generates CouchDB and Vault encryption secrets from cryptographically secure randomness instead of short word combinations.

## 1.0.0-rc.0

19th July, 2026

### Improved

- Removed the ineffective 'Use the trash bin' toggle from the settings interface. Remote deletions continue to follow Obsidian's deletion preference, while the legacy setting key remains accepted for compatibility.
- Kept content-derived chunk revisions permanently enabled, as they have been since 0.25.6, and removed the obsolete stored key from recommendations, database-maintenance prerequisites, and review tooling.
- Aligned new-Vault, full-reset, and CLI-generated settings with the 1.0 recommendations. New Vaults use cross-platform case-insensitive file-name handling, while an existing Vault with no saved case policy remains paused until case-sensitive legacy behaviour is explicitly retained or a case-insensitive database rebuild is planned.
- Improved P2P restart and settings-reapplication handling by serialising transport start and stop, keeping event handlers bound to the active replicator, and using one package-owned Trystero transport generation.
- Kept the release history available in the settings while removing automatic unread-version tracking and redirection. Release versions are no longer treated as a data-compatibility signal.
- Internal database and settings compatibility reviews now use a dedicated explanation and an explicit, case-specific resume action. They block replication without rewriting the user's automatic synchronisation choices, and older installations cannot dismiss state created by a newer version.
- Stacked compatibility-review actions vertically and kept persistent review reminders clear of mobile close controls. Long setup dialogues now keep their action area inside the mobile safe area while their content remains scrollable. A configured Vault with no device-local acknowledgement now explains that it may have been copied, restored, or opened in a new profile instead of trying to infer safety from an empty local database.
- Combined Hidden File Sync plug-in reload and Obsidian restart notifications into one mobile-safe message with clearly labelled actions, avoiding the stacked notifications reported in [issue #555](https://github.com/vrtmrz/obsidian-livesync/issues/555). A group dismissed by the user no longer reappears with its previously acknowledged rows when a later change arrives.
- Replaced remote-size decision prompts shown during startup with long-lived, clickable notices. The detailed choices now open only when requested and no longer select an answer automatically after a timeout.
- Removed the obsolete prompt and automatic bulk chunk pre-send from initial and rebuild uploads. These operations retain the standard two-pass replication used to converge follow-up writes and conflict resolution.

### Miscellaneous

- Replaced the embedded Commonlib source and generated fallback declarations with a locked compiled package, reducing duplicated release and repository-scanner inputs without changing synchronisation behaviour.
- Moved CLI standard input, prompting, and protocol output behind a host-injected Commonlib contract, and routed adapter diagnostics through the service logging API, without changing command output formats.
- Routed Webapp, WebPeer, and plug-in diagnostics through their application-owned log paths instead of writing directly to the browser console.
- Split the release history into the current 1.x line, the 0.25 line, and a legacy archive while preserving the previous `updates_old.md` link as a compatibility index.
- Prepared release automation for immutable pre-release plug-in tags, optional CLI publication, and supported Obsidian release assets only. Pre-release CLI images no longer advance stable moving tags.

### Testing

- Retired the obsolete mocked browser Harness, its root-level P2P relay helpers, and its manually dispatched `harness-ci` workflow. Unit and integration suites, the CLI two-Vault and Compose P2P scenarios, and real Obsidian E2E now own the maintained verification paths.
- Added packed-package and downstream checks for Commonlib entry points, including isolated Node and browser File System Access API storage implementations.
- Added reusable Context result contracts for Obsidian, CLI, and Webapp compositions, including a real-Obsidian smoke assertion that every service retains the host-provided Context.
- Added Commonlib stream-contract tests and downstream CLI unit and Deno E2E coverage for injected text, binary, prompt, and error channels.
- Added a dependency-ownership regression and verified the package-owned P2P transport through Compose CLI synchronisation, real-Obsidian startup and Context checks, representative desktop and mobile dialogues, and the settings pane.
