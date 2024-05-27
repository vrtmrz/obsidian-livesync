<!-- 2024-02-15 -->
# Tips and Troubleshooting


- [Tips and Troubleshooting](#tips-and-troubleshooting)
  - [Notable bugs and fixes](#notable-bugs-and-fixes)
    - [Binary files get bigger on iOS](#binary-files-get-bigger-on-ios)
    - [Some setting name has been changed](#some-setting-name-has-been-changed)
  - [FAQ](#faq)
    - [Why `Use an old adapter for compatibility` is somehow enabled in my vault?](#why-use-an-old-adapter-for-compatibility-is-somehow-enabled-in-my-vault)
    - [ZIP (or any extensions) files were not synchronised. Why?](#zip-or-any-extensions-files-were-not-synchronised-why)
    - [I hope to report the issue, but you said you needs `Report`. How to make it?](#i-hope-to-report-the-issue-but-you-said-you-needs-report-how-to-make-it)
    - [Where can I check the log?](#where-can-i-check-the-log)
    - [Why are the logs volatile and ephemeral?](#why-are-the-logs-volatile-and-ephemeral)
    - [Some network logs are not written into the file.](#some-network-logs-are-not-written-into-the-file)
    - [If a file were deleted or trimmed, the capacity of the database should be reduced, right?](#if-a-file-were-deleted-or-trimmed-the-capacity-of-the-database-should-be-reduced-right)
    - [How can I use the DevTools?](#how-can-i-use-the-devtools)
      - [Checking the network log](#checking-the-network-log)
  - [Troubleshooting](#troubleshooting)
    - [On the mobile device, cannot synchronise on the local network!](#on-the-mobile-device-cannot-synchronise-on-the-local-network)
    - [I think that something bad happening on the vault...](#i-think-that-something-bad-happening-on-the-vault)
  - [Tips](#tips)
    - [Old tips](#old-tips)

<!-- - -->


## Notable bugs and fixes
### Binary files get bigger on iOS
- Reported at: v0.20.x
- Fixed at: v0.21.2 (Fixed but not reviewed)
- Required action: larger files will not be fixed automatically, please perform `Verify and repair all files`. If our local database and storage are not matched, we will be asked to apply which one.

### Some setting name has been changed
- Fixed at: v0.22.6

| Previous name                | New name                                 |
| ---------------------------- | ---------------------------------------- |
| Open setup URI               | Use the copied setup URI                 |
| Copy setup URI               | Copy current settings as a new setup URI |
| Setup Wizard                 | Minimal Setup                            |
| Check database configuration | Check and Fix database configuration     |

## FAQ

### Why `Use an old adapter for compatibility` is somehow enabled in my vault?

Because you are a compassionate and experienced user. Before v0.17.16, we used an old adapter for the local database. At that time, current default adapter has not been stable.
The new adapter has better performance and has a new feature like purging. Therefore, we should use new adapters and current default is so.

However, when switching from an old adapter to a new adapter, some converting or local database rebuilding is required, and it takes a few time. It was a long time ago now, but we once inconvenienced everyone in a hurry when we changed the format of our database.
For these reasons, this toggle is automatically on if we have upgraded from vault which using an old adapter.

When you rebuild everything or fetch from the remote again, you will be asked to switch this.

Therefore, experienced users (especially those stable enough not to have to rebuild the database) may have this toggle enabled in their Vault.
Please disable it when you have enough time.

### ZIP (or any extensions) files were not synchronised. Why?
It depends on Obsidian detects. May toggling `Detect all extensions` of `File and links` (setting of Obsidian) will help us.

### I hope to report the issue, but you said you needs `Report`. How to make it?
We can copy the report to the clipboard, by pressing the `Make report` button on the `Hatch` pane.
![Screenshot](../images/hatch.png)

### Where can I check the log?
We can launch the log pane by `Show log` on the command palette.
And if you have troubled something, please enable the `Verbose Log` on the `General Setting` pane.

However, the logs would not be kept so long and cleared when restarted. If you want to check the logs, please enable `Write logs into the file` temporarily.

![ScreenShot](../images/write_logs_into_the_file.png)

> [!IMPORTANT]
> - Writing logs into the file will impact the performance.
> - Please make sure that you have erased all your confidential information before reporting issue.

### Why are the logs volatile and ephemeral?
To avoid unexpected exposure to our confidential things.

### Some network logs are not written into the file.
Especially the CORS error will be reported as a general error to the plug-in for security reasons. So we cannot detect and log it. We are only able to investigate them by [Checking the network log](#checking-the-network-log).

### If a file were deleted or trimmed, the capacity of the database should be reduced, right?
No, even though if files were deleted, chunks were not deleted.
Self-hosted LiveSync splits the files into multiple chunks and transfers only newly created. This behaviour enables us to less traffic. And, the chunks will be shared between the files to reduce the total usage of the database.

And one more thing, we can handle the conflicts on any device even though it has happened on other devices. This means that conflicts will happen in the past, after the time we have synchronised. Hence we cannot collect and delete the unused chunks even though if we are not currently referenced.

To shrink the database size, `Rebuild everything` only reliably and effectively. But do not worry, if we have synchronised well. We have the actual and real files. Only it takes a bit of time and traffics.

### How can I use the DevTools?

#### Checking the network log
1. Open the network pane.
2. Find the requests marked in red.
![Errored](../images/devtools1.png)
3. Capture the `Headers`, `Payload`, and, `Response`. **Please be sure to keep important information confidential**. If the `Response` contains secrets, you can omitted that.
Note: Headers contains a some credentials. **The path of the request URL, Remote Address, authority, and authorization must be concealed.**
![Concealed sample](../images/devtools2.png)

## Troubleshooting
<!-- Add here -->

### On the mobile device, cannot synchronise on the local network!
Obsidian mobile is not able to connect to the non-secure end-point, such as starting with `http://`. Make sure your URI of CouchDB. Also not able to use a self-signed certificate.

### I think that something bad happening on the vault...
Place `redflag.md` on top of the vault, and restart Obsidian. The most simple way is to create a new note and rename it to `redflag`. Of course, we can put it without Obsidian.

If there is `redflag.md`, Self-hosted LiveSync suspends all database and storage processes.

## Tips
<!-- Add here -->

### Old tips
-   Rarely, a file in the database could be corrupted. The plugin will not write to local storage when a file looks corrupted. If a local version of the file is on your device, the corruption could be fixed by editing the local file and synchronizing it. But if the file does not exist on any of your devices, then it can not be rescued. In this case, you can delete these items from the settings dialog.
-   To stop the boot-up sequence (eg. for fixing problems on databases), you can put a `redflag.md` file (or directory) at the root of your vault.
    Tip for iOS: a redflag directory can be created at the root of the vault using the File application.
-   Also, with `redflag2.md` placed, we can automatically rebuild both the local and the remote databases during the boot-up sequence. With `redflag3.md`, we can discard only the local database and fetch from the remote again.
-   Q: The database is growing, how can I shrink it down?
    A: each of the docs is saved with their past 100 revisions for detecting and resolving conflicts. Picturing that one device has been offline for a while, and comes online again. The device has to compare its notes with the remotely saved ones. If there exists a historic revision in which the note used to be identical, it could be updated safely (like git fast-forward). Even if that is not in revision histories, we only have to check the differences after the revision that both devices commonly have. This is like git's conflict-resolving method. So, We have to make the database again like an enlarged git repo if you want to solve the root of the problem.
-   And more technical Information is in the [Technical Information](tech_info.md)
-   If you want to synchronize files without obsidian, you can use [filesystem-livesync](https://github.com/vrtmrz/filesystem-livesync).
-   WebClipper is also available on Chrome Web Store:[obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)

Repo is here: [obsidian-livesync-webclip](https://github.com/vrtmrz/obsidian-livesync-webclip). (Docs are a work in progress.)
