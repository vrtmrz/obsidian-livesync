# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and real-device testing tools. These now form a coherent [Kit](https://github.com/vrtmrz/fancy-kit) rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through [OpenAI's Codex for Open Source](https://openai.com/form/codex-for-oss/). I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to [my dotfiles](https://github.com/vrtmrz/dotfiles).

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the [0.25 release history](docs/releases/0.25.md) and the [legacy release history](docs/releases/legacy.md).

## Unreleased

## 1.0.0-rc.0

19th July, 2026

### Improved

- Removed the ineffective 'Use the trash bin' toggle from the settings interface. Remote deletions continue to follow Obsidian's deletion preference, while the legacy setting key remains accepted for compatibility.
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

- Added packed-package and downstream checks for Commonlib entry points, including isolated Node and browser File System Access API storage implementations.
- Added reusable Context result contracts for Obsidian, CLI, and Webapp compositions, including a real-Obsidian smoke assertion that every service retains the host-provided Context.
- Added Commonlib stream-contract tests and downstream CLI unit and Deno E2E coverage for injected text, binary, prompt, and error channels.
- Added a dependency-ownership regression and verified the package-owned P2P transport through Compose CLI synchronisation, real-Obsidian startup and Context checks, representative desktop and mobile dialogues, and the settings pane.
