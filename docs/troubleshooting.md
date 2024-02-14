<!--  -->
# Tips and Troubleshooting

- [Notable bugs and fixes](#notable-bugs-and-fixes)
- [Troubleshooting](#troubleshooting)
- [Tips](#tips)
<!-- - -->


## Notable bugs and fixes
### Binary files get bigger on iOS
- Reported at: v0.20.x
- Fixed at: v0.21.2 (Fixed but not reviewed)
- Required action: larger files will not be fixed automatically.

<!-- Add here -->

## Troubleshooting
<!-- Add here -->

## Tips
<!-- Add here -->
### Old tips
-   If a folder becomes empty after a replication, it will be deleted by default. But you can toggle this behaviour. Check the [Settings](settings.md).
-   LiveSync mode drains more batteries in mobile devices. Periodic sync with some automatic sync is recommended.
-   Mobile Obsidian can not connect to non-secure (HTTP) or locally-signed servers, even if the root certificate is installed on the device.
-   There are no 'exclude_folders' like configurations.
-   While synchronizing, files are compared by their modification time and the older ones will be overwritten by the newer ones. Then plugin checks for conflicts and if a merge is needed, a dialog will open.
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
