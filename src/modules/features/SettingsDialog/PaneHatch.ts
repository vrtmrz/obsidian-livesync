import { stringifyYaml } from "../../../deps.ts";
import {
    type ObsidianLiveSyncSettings,
    type FilePathWithPrefix,
    type DocumentID,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LoadedEntry,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    type MetaEntry,
    type FilePath,
    DEFAULT_SETTINGS,
} from "../../../lib/src/common/types.ts";
import {
    createBlob,
    getFileRegExp,
    isDocContentSame,
    parseHeaderValues,
    readAsBlob,
} from "../../../lib/src/common/utils.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { isCloudantURI } from "../../../lib/src/pouchdb/utils_couchdb.ts";
import { getPath, requestToCouchDBWithCredentials } from "../../../common/utils.ts";
import { addPrefix, shouldBeIgnored, stripAllPrefixes } from "../../../lib/src/string_and_binary/path.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { EVENT_REQUEST_RUN_DOCTOR, EVENT_REQUEST_RUN_FIX_INCOMPLETE, eventHub } from "../../../common/events.ts";
import { ICHeader, ICXHeader, PSCHeader } from "../../../common/types.ts";
import { HiddenFileSync } from "../../../features/HiddenFileSync/CmdHiddenFileSync.ts";
import { EVENT_REQUEST_SHOW_HISTORY } from "../../../common/obsidianEvents.ts";
import { generateCredentialObject } from "../../../lib/src/replication/httplib.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
export function paneHatch(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    // const hatchWarn = this.createEl(paneEl, "div", { text: `To stop the boot up sequence for fixing problems on databases, you can put redflag.md on top of your vault (Rebooting obsidian is required).` });
    // hatchWarn.addClass("op-warn-info");

    void addPanel(paneEl, "Reset").then((paneEl) => {
        new Setting(paneEl).setName("Delete all customization sync data").addButton((button) =>
            button
                .setButtonText("Delete")
                .setDisabled(false)
                .setWarning()
                .onClick(async () => {
                    Logger(`Deleting customization sync data`, LOG_LEVEL_NOTICE);
                    const entriesToDelete = await this.plugin.localDatabase.allDocsRaw({
                        startkey: "ix:",
                        endkey: "ix:\u{10ffff}",
                        include_docs: true,
                    });
                    const newData = entriesToDelete.rows.map((e) => ({
                        ...e.doc,
                        _deleted: true,
                    }));
                    const r = await this.plugin.localDatabase.bulkDocsRaw(newData as any[]);
                    // Do not care about the result.
                    Logger(
                        `${r.length} items have been removed, to confirm how many items are left, please perform it again.`,
                        LOG_LEVEL_NOTICE
                    );
                })
        );
    });
}
