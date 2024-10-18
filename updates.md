## 0.24.0 RC Release Note

**Note:** This will be rewritten with the stable release. I confess, before you take the time, this is quite long.

Over the past three years since the inception of the plugin, various features have been implemented to address diverse user needs. This is so honourable and I am grateful for your years of support.
However, However, this process has resulted in a codebase that has become increasingly disorganised, with features becoming entangled.

Consequently, this has led to a situation where bugs can go unnoticed or resolving one issue may inadvertently introduce another.

In 0.24.0, I reorganised the previously disjointed main codebase into clearly defined modules. Although I anticipated that the overall volume of code would not increase, I discovered that it has, in fact, expanded. While the complexity may still be considerable, the refactoring has enhanced clarity regarding the current structure of the code. (The next focus may involve a review of dependencies).

Throughout this process, a significant number of bugs have been resolved. And it may be worth mentioning that these bugs may had given rise to other bugs. I kindly request that you verify whether your issues have been addressed. At least conflict resolution and related issues have improved significantly.

It is also the first step towards a fully-fledged-fancy LiveSync, not just a plug-in from Obsidian. Of course, it will still be a plug-in as a first class and foremost, but this development marks a significant step towards the self-hosting concept.

This dev release is very close to the beta version that I had previously indicated would not be released. As a result, I have faced challenges in maintaining the main branch while working on this dev release. Regrettably, I have not been able to make any commits to the main branch in the last three weeks. Thus, the dev branch will remain reserved for major changes only.

The Release Candidate will be available for a few days and will only be officially released once users, including myself, have confirmed that there are no issues.

Finally, I would like to once again express my respect and gratitude to all of you once again. Thank you for your interest in the development version. Your contributions and dedication are greatly appreciated through testing.

Thank you, and I hope your troubles will be resolved!

---

## 0.24.0.dev-rc4

### Improved

-   The welcome message is now more simple to encourage the use of the Setup-URI.
    -   And the secondary message is also simpler to guide users to Minimal Setup.
        -   But Setup-URI will be recommended again, due to its importance.
    -   These dialogues contain a link to the documentation which can be clicked.
-   The minimal setup is more minimal now. And, the setup is more user-friendly.
    -   Now the Configuration of the remote database is checked more robust, but we can ignore the warning and proceed with the setup.
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

### Fixed

-   While restarting the plug-in, the shown dialogues will be automatically closed to avoid unexpected behaviour.
-   Replicated documents that the local device has configured to ignore are now correctly ignored.
-   The chunks of the document on the local device during the first transfer will be created correctly.
    -   And why we should create them is now explained in the dialogue.
-   If optional features have been enabled in the wizard, `Enable advanced features` will be toggled correctly.

### Changed

-   Some default settings have been changed for easier new user experience.
    -   Preventing the meaningless migration of the settings.

### Tidied

-   Commented-out codes have been gradually removed.

## 0.24.0.dev-rc3

### Fixed

-   No longer Missing Translation Warning is shown in the console.
-   Fixed the issue where some functions were not working properly (`_` started functions).

## 0.24.0.dev-rc2

### Fixed

-   Some status icons is now shown correctly.

## 0.24.0-rc1

### Fixed

-   A fair numbers of bugs have been fixed.

### Tiding

-   The codebase has been reorganised into clearly defined modules.

Older notes is in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
