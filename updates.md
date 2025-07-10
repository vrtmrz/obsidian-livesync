## 0.24.31

10th July, 2025

### Fixed

- The description of `Enable Developers' Debug Tools.` has been refined.
    - Now performance impact is more clearly stated.
- Automatic conflict checking and resolution has been improved.
    - It now works parallelly for each other file, instead of sequentially. It makes significantly faster on first synchronisation when with local files information.
- Resolving conflicts dialogue will not be shown for the multiple files at once.
    - It will be shown for each file, one by one.

## 0.24.30

9th July, 2025

### New Feature

- New chunking algorithm `V3: Fine deduplication` has been added, and will be recommended after updates.
    - The Rabin-Karp algorithm is used for efficient chunking.
    - This will be the default in the new installations.
    - It is more robust and faster than the previous one.
    - We can change it in the `Advanced` pane of the settings.
- New language `ko` (Korean) has been added.
    - Thank you for your contribution, [@ellixspace](https://x.com/ellixspace)!
        - Any contributions are welcome, from any route. Please let me know if I seem to be unaware of this. It is often the case that I am not really aware of it.
- Chinese (Simplified) translation has been updated.
    - Thank you for your contribution, [@52sanmao](https://github.com/52sanmao)!

### Fixed

- Numeric settings are now never lost the focus during value changing.
- Doctor now redacts more sensitive information on error reports.

### Improved

- All translations have been rewritten into YAML format, to easier to manage and contribute.
    - We can write them with comments, newlines, and other YAML features.
- Doctor recommendations are now shown in a user-friendly notation.
    - We can now see the recommended as `V3: Fine deduplication` instead of `v3-rabin-karp`.

### Refactored

- Never-ending `ObsidianLiveSyncSettingTab.ts` has finally been separated into each pane's file.
- Some commented-out code has been removed.

### Acknowledgement

- Jun Murakami, Shun Ishiguro, and Yoshihiro Oyama. 2012. Implementation and Evaluation of a Cache Deduplication Mechanism with Content-Defined Chunking. In _IPSJ SIG Technical Report_, Vol.2012-ARC-202, No.4. Information Processing Society of Japan, 1-7.

## 0.24.29

20th June, 2025

### Fixed

- Synchronisation with buckets now works correctly, regardless of whether a prefix is set or the bucket has been (re-) initialised (#664).
- An information message is now displayed again, during any automatic synchronisation is enabled (#662).

### Tidied up

- Importing paths have been tidied up.

## 0.24.28

15th June, 2025

### Fixed

- Batch Update is no longer available in LiveSync mode to avoid unexpected behaviour. (#653)
- Now compatible with Cloudflare R2 again for bucket synchronisation.
    - @edo-bari-ikutsu, thank you for [your contribution](https://github.com/vrtmrz/livesync-commonlib/pull/12)!
- Prevention of broken behaviour due to database connection failures added (#649).

## 0.24.27

10th June, 2025

### Improved

- We can use prefix for path for the Bucket synchronisation.
    - For example, if you set the `vaultName/` as a prefix for the bucket in the root directory, all data will be transferred to the bucket under the `vaultName/` directory.
- The "Use Request API to avoid `inevitable` CORS problem" option is now promoted to the normal setting, not a niche patch.

### Fixed

- Now switching replicators applied immediately, without the need to restart Obsidian.

### Tidied up

- Some dependencies have been updated to the latest version.

## 0.24.26

14th May, 2025

This update introduces an option to circumvent Cross-Origin Resource Sharing
(CORS) constraints for CouchDB requests, by leveraging Obsidian's native request
API. The implementation of such a feature had previously been deferred due to
significant security considerations.

CORS is a vital security mechanism, enabling servers like CouchDB -- which
functions as a sophisticated REST API -- to control access from different
origins, thereby ensuring secure communication across trust boundaries. I had
long hesitated to offer a CORS circumvention method, as it deviates from
security best practices; My preference was for users to configure CORS correctly
on the server-side.

However, this policy has shifted due to specific reports of intractable
CORS-related configuration issues, particularly within enterprise proxy
environments where proxy servers can unpredictably alter or block
communications. Given that a primary objective of the "Self-hosted LiveSync"
plugin is to facilitate secure Obsidian usage within stringent corporate
settings, addressing these 'unavoidable' user-reported problems became
essential. Mostly raison d'être of this plugin.

Consequently, the option "Use Request API to avoid `inevitable` CORS problem"
has been implemented. Users are strongly advised to enable this _only_ when
operating within a trusted environment. We can enable this option in the `Patch` pane.

However, just to whisper, this is tremendously fast.

### New Features

- Automatic display-language changing according to the Obsidian language
  setting.
    - We will be asked on the migration or first startup.
    - **Note: Please revert to the default language if you report any issues.**
    - Not all messages are translated yet. We welcome your contribution!
- Now we can limit files to be synchronised even in the hidden files.
- "Use Request API to avoid `inevitable` CORS problem" has been implemented.
    - Less secure, please use it only if you are sure that you are in the trusted
      environment and be able to ignore the CORS. No `Web viewer` or similar tools
      are recommended. (To avoid the origin forged attack). If you are able to
      configure the server setting, always that is recommended.
- `Show status icon instead of file warnings banner` has been implemented.
    - If enabled, the ⛔ icon will be shown inside the status instead of the file
      warnings banner. No details will be shown.

### Improved

- All regular expressions can be inverted by prefixing `!!` now.

### Fixed

- No longer unexpected files will be gathered during hidden file sync.
- No longer broken `\n` and new-line characters during the bucket
  synchronisation.
- We can purge the remote bucket again if we using MinIO instead of AWS S3 or
  Cloudflare R2.
- Purging the remote bucket is now more reliable.
    - 100 files are purged at a time.
- Some wrong messages have been fixed.

### Behaviour changed

- Entering into the deeper directories to gather the hidden files is now limited
  by `/` or `\/` prefixed ignore filters. (It means that directories are scanned
  deeper than before).
    - However, inside the these directories, the files are still limited by the
      ignore filters.

### Etcetera

- Some code has been tidied up.
- Trying less warning-suppressing and be more safer-coding.
- Dependent libraries have been updated to the latest version.
- Some build processes have been separated to `pre` and `post` processes.

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
