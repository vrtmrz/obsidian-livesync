# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

## 1.0.27

7th September, 2026

For now, I am addressing the issues I can resolve first. I hope this helps.

### Synchronisation and storage

#### Fixed

- First-time Object Storage setup now completes when **Use Custom HTTP Handler** is enabled for an empty remote, including a new Cloudflare R2 bucket. LiveSync can now create the remote state required to begin synchronisation. (#1166)

## 1.0.26

~~1.0.25~~ was cancelled because pre-release validation found that LiveSync could appear to finish synchronising even though Android had not written a received file to the Vault; the warning appeared only after restart.

6th September, 2026

### Synchronisation and storage

#### Fixed

- Files inside a folder are no longer silently removed from synchronisation when an external tool changes only the letter case of that folder while Obsidian is running. This prevents the stale deletion from reaching other devices or later removing the local file. Moving files into ignored or otherwise excluded locations retains the existing behaviour, and the folder-name case itself may still differ between devices. (#1168)
- A problem processing one file during ordinary start-up no longer prevents every other file from synchronising. LiveSync warns about the affected files and can retry them later; Fetch and Rebuild still stop if they cannot finish safely. (#1164)
- When LiveSync cannot finish preparing this device for synchronisation, it now says that synchronisation is unavailable and directs you to generate a report, instead of remaining at 'Not ready'. (#1164)

#### Improved

- When LiveSync cannot write a received file to the Vault, it now warns immediately instead of appearing to have synchronised it successfully. The generated report identifies the affected path, and a later scan can try it again.

### Conflict handling and recovery

#### Improved

- Conflict resolution dialogues now close when the same file is resolved elsewhere or when the plug-in unloads. Requests for different files are shown one at a time, while a newer request for the same file replaces the older one.

### Setup and compatibility

#### Improved

- Unconfigured Vaults now stay focused on setup instead of running Config Doctor or incomplete-document checks before they can be used. Returning a configured Vault to an unconfigured state also stops those checks until the requested restart. (#1161)
- When the active file contains a file or folder name longer than 255 UTF-8 bytes, LiveSync now explains that the path may not work on some Android and Linux file systems. It does not rename or reject the file. (#1164)

## 1.0.24

3rd September, 2026

### Interface and translation

#### Fixed

- The Setup Wizard now correctly explains that the existing-device path adds this device to an existing synchronisation (PR #1118). Thank you to @nikhilmaddirala for the contribution!
- Spanish translations now resolve the **Display language** placeholder, cover previously untranslated Setup Wizard and CouchDB text, translate user-facing Config Doctor values and confirmation controls, and use Spanish sentence case (PR #1129). Thank you to @zeedif for the contribution!

#### Improved

- The Setup Wizard now shows the passphrase and **Obfuscate Properties** controls only after E2EE is enabled, provides a password-visibility button, allows longer translated labels to wrap, and keeps the invitation link compact on desktop while preserving its mobile touch target (PR #1130). Thank you to @zeedif for the contribution!

### Synchronisation and storage

#### Fixed

- **Overwrite Server Data with This Device's Files** now keeps this device's synchronisation settings instead of reapplying settings from the remote database which is about to be replaced. Enabling E2EE before a rebuild therefore remains enabled and uploads encrypted data. (#1146)

### Command-line tool

#### Fixed

- The systemd installer now finds the repository root correctly, installs every generated bundle chunk and required production dependency, checks the installed command before activation, and reports success only when the service remains active.

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
