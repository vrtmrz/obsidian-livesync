# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

## 1.0.28

9th September, 2026

I came across an article online that put its finger on something fundamental. Writing up the details in what seemed the most fitting format helped me organise my thoughts considerably.

The resulting manuscript and citation information are now available in the project's GitHub repository for researchers and practitioners who would like to cite Self-hosted LiveSync.

### Setup and compatibility

#### Fixed

- A missing legacy file-name case setting no longer makes the configuration mismatch dialogue require a database rebuild when this device already uses case-insensitive handling. Case-sensitive handling now correctly requires a compatibility decision when the remote omits that setting.
- Configuration review now compares the selected remote profile's trial settings, and discards a pending decision if its settings or active connection change before it can be applied.

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
