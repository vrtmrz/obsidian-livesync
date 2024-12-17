## 0.24.0

I know that we have been waiting for a long time. It is finally released!

Over the past three years since the inception of the plugin, various features have been implemented to address diverse user needs. This is truly honourable, and I am grateful for your years of support. However, this process has led to an increasingly disorganised codebase, with features becoming entangled. Consequently, this has led to a situation where bugs can go unnoticed and resolving one issue may inadvertently introduce another.

In 0.24.0, I reorganised the previously jumbled main codebase into clearly defined modules. Although I had assumed that the total size of the code would not increase, I discovered that it has in fact increased. While the complexity is still considerable, the refactoring has improved the clarity of the code's structure. Additionally, while testing the release candidates, we still found many bugs to fix, which helped to make this plug-in robust and stable. Therefore, we are now ready to use the updated plug-in, and in addition to that, proceed to the next step.

This is also the first step towards a fully-fledged-fancy LiveSync, not just a plug-in from Obsidian. Of course, it will still be a plug-in primarily and foremost, but this development marks a significant step towards the self-hosting concept.

Finally, I would like to once again express my respect and gratitude to all of you. My gratitude extends to all of the dev testers! Your contributions have certainly made the plug-in robust and stable!

Thank you, and I hope your troubles will be resolved!

---
## 0.24.6

### Fixed (Quick Fix)

-   Fixed the issue of log is not displayed on the log pane if the pane has not been shown on startup.
    -   This release is only for it. However, fixing this had been necessary to report any other issues.

## 0.24.5

### Fixed

-   Fixed incorrect behaviour when comparing objects with undefined as a property value.

### Improved

-   The status line and the log summary are now displayed more smoothly and efficiently.
    -   This improvement has also been applied to the logs displayed in the log pane.

## 0.24.4

### Fixed

-   Fixed so many inefficient and buggy modules inherited from the past.

### Improved

-   Tasks are now executed in an efficient asynchronous library.
-   On-demand chunk fetching is now more efficient and keeps the interval between requests.
    -   This will reduce the load on the server and the network.
    -   And, safe for the Cloudant.

## 0.24.3

### Improved

-   Many messages have been improved for better understanding as thanks to the fine works of @Volkor3-16! Thank you so much!
-   Documentations also have been updated to reflect the changes in the messages.
-   Now the style of In-Editor Status has been solid for some Android devices.

## 0.24.2

### Rewritten

-   Hidden File Sync is now respects the file changes on the storage. Not simply comparing modified times.
    -   This makes hidden file sync more robust and reliable.

### Fixed

-   `Scan hidden files before replication` is now configurable again.
-   Some unexpected errors are now handled more gracefully.
-   Meaningless event passing during boot sequence is now prevented.
-   Error handling for non-existing files has been fixed.
-   Hidden files will not be batched to avoid the potential error.
    -   This behaviour had been causing the error in the previous versions in specific situations.
-   The log which checking automatic conflict resolution is now in verbose level.
-   Replication log (skipping non-targetting files) shows the correct information.
-   The dialogue that asking enabling optional feature during `Rebuild Everything` now prevents to show the `overwrite` option.
    -   The rebuilding device is the first, meaningless.
-   Files with different modified time but identical content are no longer processed repeatedly.
-   Some unexpected errors which caused after terminating plug-in are now avoided.
-

### Improved

-   JSON files are now more transferred efficiently.
    -   Now the JSON files are transferred in more fine chunks, which makes the transfer more efficient.

## 0.24.1

### Fixed

-   Vault History can show the correct information of match-or-not for each file and database even if it is a binary file.
-   `Sync settings via markdown` is now hidden during the setup wizard.
-   Verify and Fix will ignore the hidden files if the hidden file sync is disabled.

#### New feature

-   Now we can fetch the tweaks from the remote database while the setting dialogue and wizard are processing.

### Improved

-   More things are moved to the modules.
    -   Includes the Main codebase. Now `main.ts` is almost stub.
-   EventHub is now more robust and typesafe.

## 0.24.0

### Improved

-   The welcome message is now more simple to encourage the use of the Setup-URI.
    -   The secondary message is also simpler to guide users to Minimal Setup.
        -   But Setup-URI will be recommended again, due to its importance.
    -   These dialogues contain a link to the documentation which can be clicked.
-   The minimal setup is more minimal now. And, the setup is more user-friendly.
    -   Now the Configuration of the remote database is checked more robustly, but we can ignore the warning and proceed with the setup.
-   Before we are asked about each feature, we are asked if we want to use optional features in the first place.
    -   This is to prevent the user from being overwhelmed by the features.
    -   And made it clear that it is not recommended for new users.
-   Many messages have been improved for better understanding.
    -   Ridiculous messages have been (carefully) refined.
    -   Dialogues are more informative and friendly.
        -   A lot of messages have been mostly rewritten, leveraging Markdown.
        -   Especially auto-closing dialogues are now explicitly labelled: `To stop the countdown, tap anywhere on the dialogue`.
-   Now if the is plugin configured to ignore some events, we will get a chance to fix it, in addition to the warning.
    -   And why that has happened is also explained in the dialogue.
-   A note relating to device names has been added to Customisation Sync on the setting dialogue.
-   We can verify and resolve also the hidden files now.

### Fixed

-   We can resolve the conflict of the JSON file correctly now.
-   Verifying files between the local database and storage is now working correctly.
-   While restarting the plug-in, the shown dialogues will be automatically closed to avoid unexpected behaviour.
-   Replicated documents that the local device has configured to ignore are now correctly ignored.
-   The chunks of the document on the local device during the first transfer will be created correctly.
    -   And why we should create them is now explained in the dialogue.
-   If optional features have been enabled in the wizard, `Enable advanced features` will be toggled correctly.
    The hidden file sync is now working correctly. - Now the deletion of hidden files is correctly synchronised.
-   Customisation Sync is now working correctly together with hidden file sync.
-   No longer database suffix is stored in the setting sharing markdown.
-   A fair number of bugs have been fixed.

### Changed

-   Some default settings have been changed for an easier new user experience.
    -   Preventing the meaningless migration of the settings.

### Tiding

-   The codebase has been reorganised into clearly defined modules.
-   Commented-out codes have been gradually removed.

Older notes are in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
