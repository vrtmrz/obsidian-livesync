import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger.js";
import { SETTING_VERSION_SUPPORT_CASE_INSENSITIVE } from "../../lib/src/common/types.js";
import {
    EVENT_REQUEST_OPEN_SETTING_WIZARD,
    EVENT_REQUEST_OPEN_SETTINGS,
    EVENT_REQUEST_OPEN_SETUP_URI,
    eventHub,
} from "../../common/events.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

const URI_DOC = "https://github.com/vrtmrz/obsidian-livesync/blob/main/README.md#how-to-use";

export class ModuleMigration extends AbstractModule implements ICoreModule {
    async migrateDisableBulkSend() {
        if (this.settings.sendChunksBulk) {
            this._log(
                "Send chunks in bulk has been enabled, however, this feature had been corrupted. Sorry for your inconvenience. Automatically disabled.",
                LOG_LEVEL_NOTICE
            );
            this.settings.sendChunksBulk = false;
            this.settings.sendChunksBulkMaxSize = 1;
            await this.saveSettings();
        }
    }
    async migrationCheck() {
        const old = this.settings.settingVersion;
        const current = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
        // Check each migrations(old -> current)
        if (!(await this.migrateToCaseInsensitive(old, current))) {
            this._log(`Migration failed or cancelled from ${old} to ${current}`, LOG_LEVEL_NOTICE);
            return;
        }
    }
    async migrateToCaseInsensitive(old: number, current: number) {
        if (
            this.settings.handleFilenameCaseSensitive !== undefined &&
            this.settings.doNotUseFixedRevisionForChunks !== undefined
        ) {
            if (current < SETTING_VERSION_SUPPORT_CASE_INSENSITIVE) {
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                await this.saveSettings();
            }
            return true;
        }
        if (
            old >= SETTING_VERSION_SUPPORT_CASE_INSENSITIVE &&
            this.settings.handleFilenameCaseSensitive !== undefined &&
            this.settings.doNotUseFixedRevisionForChunks !== undefined
        ) {
            return true;
        }

        let remoteHandleFilenameCaseSensitive: undefined | boolean = undefined;
        let remoteDoNotUseFixedRevisionForChunks: undefined | boolean = undefined;
        let remoteChecked = false;
        try {
            const remoteInfo = await this.core.replicator.getRemotePreferredTweakValues(this.settings);
            if (remoteInfo) {
                remoteHandleFilenameCaseSensitive =
                    "handleFilenameCaseSensitive" in remoteInfo ? remoteInfo.handleFilenameCaseSensitive : false;
                remoteDoNotUseFixedRevisionForChunks =
                    "doNotUseFixedRevisionForChunks" in remoteInfo ? remoteInfo.doNotUseFixedRevisionForChunks : false;
                if (
                    remoteHandleFilenameCaseSensitive !== undefined ||
                    remoteDoNotUseFixedRevisionForChunks !== undefined
                ) {
                    remoteChecked = true;
                }
            } else {
                this._log("Failed to fetch remote tweak values", LOG_LEVEL_INFO);
            }
        } catch (ex) {
            this._log("Could not get remote tweak values", LOG_LEVEL_INFO);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }

        if (remoteChecked) {
            // The case that the remote could be checked.
            if (remoteHandleFilenameCaseSensitive && remoteDoNotUseFixedRevisionForChunks) {
                // Migrated, but configured as same as old behaviour.
                this.settings.handleFilenameCaseSensitive = true;
                this.settings.doNotUseFixedRevisionForChunks = true;
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                this._log(`Migrated to db:${current} with the same behaviour as before`, LOG_LEVEL_INFO);
                await this.saveSettings();
                return true;
            }
            const message = `As you may already know, the self-hosted LiveSync has changed its default behaviour and database structure.

And thankfully, with your time and efforts, the remote database appears to have already been migrated. Congratulations!

However, we need a bit more. The configuration of this device is not compatible with the remote database. We will need to fetch the remote database again. Should we fetch from the remote again now?

___Note: We cannot synchronise until the configuration has been changed and the database has been fetched again.___
___Note2: The chunks are completely immutable, we can fetch only the metadata and difference.___
`;
            const OPTION_FETCH = "Yes, fetch again";
            const DISMISS = "No, please ask again";
            const options = [OPTION_FETCH, DISMISS];
            const ret = await this.core.confirm.confirmWithMessage(
                "Case Sensitivity",
                message,
                options,
                "No, please ask again",
                40
            );
            if (ret == OPTION_FETCH) {
                this.settings.handleFilenameCaseSensitive = remoteHandleFilenameCaseSensitive || false;
                this.settings.doNotUseFixedRevisionForChunks = remoteDoNotUseFixedRevisionForChunks || false;
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                await this.saveSettings();
                try {
                    await this.core.rebuilder.scheduleFetch();
                    return;
                } catch (ex) {
                    this._log("Failed to create redflag2", LOG_LEVEL_VERBOSE);
                    this._log(ex, LOG_LEVEL_VERBOSE);
                }
                return false;
            } else {
                return false;
            }
        }

        const ENABLE_BOTH = "Enable both";
        const ENABLE_FILENAME_CASE_INSENSITIVE = "Enable only #1";
        const ENABLE_FIXED_REVISION_FOR_CHUNKS = "Enable only #2";
        const ADJUST_TO_REMOTE = "Adjust to remote";
        const DISMISS = "Decide it later";
        const KEEP = "Keep previous behaviour";
        const message = `Since v0.23.21, the self-hosted LiveSync has changed the default behaviour and database structure. The following changes have been made:

1. **Case sensitivity of filenames** 
   The handling of filenames is now case-insensitive. This is a beneficial change for most platforms, other than Linux and iOS, which do not manage filename case sensitivity effectively.
   (On These, a warning will be displayed for files with the same name but different cases).

2. **Revision handling of the chunks** 
   Chunks are immutable, which allows their revisions to be fixed. This change will enhance the performance of file saving.

___However, to enable either of these changes, both remote and local databases need to be rebuilt. This process takes a few minutes, and we recommend doing it when you have ample time.___

- If you wish to maintain the previous behaviour, you can skip this process by using \`${KEEP}\`.
- If you do not have enough time, please choose \`${DISMISS}\`. You will be prompted again later.
- If you have rebuilt the database on another device, please select \`${DISMISS}\` and try synchronizing again. Since a difference has been detected, you will be prompted again.
`;
        const options = [ENABLE_BOTH, ENABLE_FILENAME_CASE_INSENSITIVE, ENABLE_FIXED_REVISION_FOR_CHUNKS];
        if (remoteChecked) {
            options.push(ADJUST_TO_REMOTE);
        }
        options.push(KEEP, DISMISS);
        const ret = await this.core.confirm.confirmWithMessage("Case Sensitivity", message, options, DISMISS, 40);
        console.dir(ret);
        switch (ret) {
            case ENABLE_BOTH:
                this.settings.handleFilenameCaseSensitive = false;
                this.settings.doNotUseFixedRevisionForChunks = false;
                break;
            case ENABLE_FILENAME_CASE_INSENSITIVE:
                this.settings.handleFilenameCaseSensitive = false;
                this.settings.doNotUseFixedRevisionForChunks = true;
                break;
            case ENABLE_FIXED_REVISION_FOR_CHUNKS:
                this.settings.doNotUseFixedRevisionForChunks = false;
                this.settings.handleFilenameCaseSensitive = true;
                break;
            case KEEP:
                this.settings.handleFilenameCaseSensitive = true;
                this.settings.doNotUseFixedRevisionForChunks = true;
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                await this.saveSettings();
                return true;
            case DISMISS:
            default:
                return false;
        }
        this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
        await this.saveSettings();
        await this.core.rebuilder.scheduleRebuild();
        await this.core.$$performRestart();
    }

    async initialMessage() {
        const message = `Your device has **not been set up yet**. Let me guide you through the setup process.

Please keep in mind that every dialogue content can be copied to the clipboard. If you need to refer to it later, you can paste it into a note in Obsidian. You can also translate it into your language using a translation tool.

First, do you have **Setup URI**?

Note: If you do not know what it is, please refer to the [documentation](${URI_DOC}).
`;

        const USE_SETUP = "Yes, I have";
        const NEXT = "No, I do not have";

        const ret = await this.core.confirm.askSelectStringDialogue(message, [USE_SETUP, NEXT], {
            title: "Welcome to Self-Hosted LiveSync",
            defaultAction: USE_SETUP,
        });
        if (ret === USE_SETUP) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
            return false;
        } else if (ret == NEXT) {
            return true;
        }
        return false;
    }

    async askAgainForSetupURI() {
        const message = `We strongly recommend that you generate a set-up URI and use it.
If you do not have knowledge about it, please refer to the [documentation](${URI_DOC}) (Sorry again, but it is important).

How do you want to set it up manually?`;

        const USE_MINIMAL = "Take me into the setup wizard";
        const USE_SETUP = "Set it up all manually";
        const NEXT = "Remind me at the next launch";

        const ret = await this.core.confirm.askSelectStringDialogue(message, [USE_MINIMAL, USE_SETUP, NEXT], {
            title: "Recommendation to use Setup URI",
            defaultAction: USE_MINIMAL,
        });
        if (ret === USE_MINIMAL) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETTING_WIZARD);
            return false;
        }
        if (ret === USE_SETUP) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETTINGS);
            return false;
        } else if (ret == NEXT) {
            return false;
        }
        return false;
    }

    async $everyOnFirstInitialize(): Promise<boolean> {
        if (!this.localDatabase.isReady) {
            this._log(`Something went wrong! The local database is not ready`, LOG_LEVEL_NOTICE);
            return false;
        }
        if (this.settings.isConfigured) {
            await this.migrationCheck();
            await this.migrateDisableBulkSend();
        }
        if (!this.settings.isConfigured) {
            // Case sensitivity
            if (!(await this.initialMessage()) || !(await this.askAgainForSetupURI())) {
                this._log(
                    "The setup has been cancelled, Self-Hosted LiveSync waiting for your setup!",
                    LOG_LEVEL_NOTICE
                );
                return false;
            }
        }
        return true;
    }
}
