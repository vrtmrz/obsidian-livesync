# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

## 1.0.23

2nd September, 2026

I am sorry to make this release while several pull requests are still awaiting merge, but I believe that the safeguards provided by this work are significant, so I have decided to release it. I will merge the remaining pull requests in turn. Thank you for bearing with me while I have been less active recently.

### Synchronisation and storage

#### Fixed

- **Sync now** once again keeps routine progress quiet, while still opening recovery dialogues when a decision is required. Repeated OneShot Sync requests received while an earlier attempt is running are now ignored instead of starting overlapping work.

## 1.0.22

1st September, 2026

I am sorry to make this release while several pull requests are still awaiting merge, but I believe that the safeguards provided by this work are significant, so I have decided to release it. I will merge the remaining pull requests in turn. Thank you for bearing with me while I have been less active recently.

### Synchronisation and storage

#### Fixed

- **Sync on Startup** now runs an immediate Object Storage synchronisation after start-up or resume, including migrated profiles which retain a Continuous setting that Object Storage cannot use.
- A temporarily unavailable Object Storage synchronisation-parameter read is no longer treated as a missing object and cannot regenerate the shared Security Seed. Flow-specific Security Seed checks also bypass an earlier process-cached result.
- Local database reset and plug-in unload now retire active replication through its owner before closing the database, without reporting a missing active Replicator or describing unload as a database reset.
- **Fresh Start Wipe** now reports an incomplete Object Storage deletion instead of announcing success, and releases its temporary storage client after each attempt.

### Peer-to-peer synchronisation

#### Fixed

- The P2P Setup connection test no longer interrupts an active P2P room. It observes an active compatible relay binding, blocks a test which would add another relay until P2P is disconnected, and uses a short-lived trial only while P2P is idle.
- User-initiated P2P synchronisation now reports success only after the requested target transfer completes.
- Optional WebApp P2P synchronisation now becomes ready after a successful local-file scan even when CouchDB remains unconfigured; failed preparation is not reported as ready.
- Unattended P2P synchronisation no longer raises Notice-level messages for missing configured targets, authentication rejection, configuration mismatch, or an overlapping transfer. User-initiated operations retain their existing feedback.
- P2P replication failure reasons now survive the JSON RPC boundary instead of reaching the requesting device as an empty object.

### Command-line interface

#### Fixed

- `mark-resolved`, `lock-remote`, and `unlock-remote` now return a non-zero exit code when the selected provider cannot verify the requested remote state. Use `--compat-remote-admin-exit-zero` to retain the former exit code for returned verification failures; unknown remote IDs and mutation errors still fail.

## 1.0.21

26th August, 2026

It is becoming more 'ordinary' with each release, but please let me know if anything has become less convenient.

### Interface and translation

#### Fixed

- Remote Configuration section headings no longer overlap their contents when scrolling on mobile. Action buttons in Remote Configuration, Maintenance, and Patches now remain inside the settings pane on narrow screens.

## 1.0.20

~~1.0.19~~ was cancelled because prerelease validation exposed an incorrect warning at start-up.

25th August, 2026

I know this is the second time I have said it, but I had grown quite fond of the settings screen. It seems, however, that a simpler, healthier life is called for.

### Interface and translation

#### Fixed

- Compatibility pause warnings now direct you to the dedicated compatibility review instead of the Change Log.
- The Obsidian 1.13 settings page now waits for saved settings before choosing its initial layout. This prevents a spurious missing-replicator warning at start-up, keeps configured devices on the Synchronisation-first layout even when automatic synchronisation triggers are disabled, and keeps Quick Setup first on unconfigured devices.

#### Improved

- Settings page names, controls in General Settings, Quick Setup actions, and Advanced controls now use Obsidian 1.13's native settings interface and global search, while retaining their familiar icons. The landing page keeps Remote Configuration and Sync Settings together, places Appearance, Logging, and Extra menus under General Settings, and groups maintenance, optional features, advanced settings, and help by purpose. Earlier supported Obsidian versions continue to use the pane-based interface.
- Settings changes which require database initialisation now use a focused Setup Manager dialogue to choose between existing synchronisation data and the files in the current Vault. The selected reset or rebuild is reserved before the settings are saved, while cancelling offers a separate, explicit settings-only fallback.

## 1.0.18

24th August, 2026

### Synchronisation and storage

#### Fixed

- Reset and rebuild workflows now use the local database selected by their updated settings, preventing stale data from reopening after a **Database Suffix** change. If database initialisation does not complete, the workflow remains paused instead of continuing with incomplete state.

#### Improved

- Rebuilds now recheck restored file events against the current Vault, use current file contents, and finish processing them before the plug-in reports readiness.

## 1.0.17

23rd August, 2026

### Interface and translation

#### Fixed

- Settings generated from the settings manifest, Setup Wizard configuration summaries, and warnings about externally changed settings now honour **Display language** when a translation is available, instead of remaining in English (PR #1123). Thank you to @nimula for the contribution!

### Peer-to-peer synchronisation

#### Improved

- P2P connection profiles now provide four **P2P message size** presets and a **Connection path** choice between **Automatic** and **TURN relay only**. Smaller messages can improve compatibility on paths which fragment or drop larger WebRTC messages, while relay-only routing requires a configured TURN server. P2P connection strings and encrypted Setup URIs preserve both choices.
    - Thank you to @andrewschreiber for the detailed fragmentation diagnosis and working 800-byte threshold in vrtmrz/livesync-commonlib#97, which informed this compatibility design.
- An optional self-hosted Coturn Compose starter is now available for P2P deployments that need a TURN relay. It uses a pinned upstream image and documents its network, credential, security, and verification boundaries.

## 1.0.16

19th August, 2026

### Conflict handling and recovery

#### Fixed

- **Back to this revision** in Document History now restores the selected content as a new non-deleted successor revision before reflecting it to the Vault. A readable revision restored after a logical deletion therefore remains restored through later synchronisation instead of being overwritten by the deletion.
    - If the file changes while restoration is in progress, the operation stops instead of extending a stale revision. Existing conflicts remain available through **Inspect conflicts and file/database differences**.

### Synchronisation and storage

#### Improved

- One-shot CouchDB synchronisation now releases stalled web-compatible connection checks before replication starts, so a later synchronisation can make a fresh attempt (Commonlib 0.1.16).
    - The 60-second safeguard applies only to pre-replication checks. It does not limit ordinary synchronisation, and the **Use Internal API** path is unchanged.
