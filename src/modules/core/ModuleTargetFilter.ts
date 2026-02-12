import { LRUCache } from "octagonal-wheels/memory/LRUCache";
import { getStoragePathFromUXFileInfo, useMemo } from "../../common/utils";
import {
    LOG_LEVEL_VERBOSE,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
    type UXFileInfoStub,
} from "../../lib/src/common/types";
import { isAcceptedAll } from "../../lib/src/string_and_binary/path";
import { AbstractModule } from "../AbstractModule";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import { isDirty } from "../../lib/src/common/utils";
import type { LiveSyncCore } from "../../main";
export class ModuleTargetFilter extends AbstractModule {
    reloadIgnoreFiles() {
        this.ignoreFiles = this.settings.ignoreFiles.split(",").map((e) => e.trim());
    }
    private _everyOnload(): Promise<boolean> {
        this.reloadIgnoreFiles();
        eventHub.onEvent(EVENT_SETTING_SAVED, (evt: ObsidianLiveSyncSettings) => {
            this.reloadIgnoreFiles();
        });
        eventHub.onEvent(EVENT_REQUEST_RELOAD_SETTING_TAB, () => {
            this.reloadIgnoreFiles();
        });
        return Promise.resolve(true);
    }

    _markFileListPossiblyChanged(): void {
        this.totalFileEventCount++;
    }
    totalFileEventCount = 0;
    get fileListPossiblyChanged() {
        if (isDirty("totalFileEventCount", this.totalFileEventCount)) {
            return true;
        }
        return false;
    }

    private async _isTargetFile(file: string | UXFileInfoStub, keepFileCheckList = false) {
        const fileCount = useMemo<Record<string, number>>(
            {
                key: "fileCount", // forceUpdate: !keepFileCheckList,
            },
            (ctx, prev) => {
                if (keepFileCheckList && prev) return prev;
                if (!keepFileCheckList && prev && !this.fileListPossiblyChanged) {
                    return prev;
                }
                const fileList = (ctx.get("fileList") ?? []) as FilePathWithPrefix[];
                // const fileNameList = (ctx.get("fileNameList") ?? []) as FilePath[];
                // const fileNames =
                const vaultFiles = this.core.storageAccess.getFileNames().sort();
                if (prev && vaultFiles.length == fileList.length) {
                    const fl3 = new Set([...fileList, ...vaultFiles]);
                    if (fileList.length == fl3.size && vaultFiles.length == fl3.size) {
                        return prev;
                    }
                }
                ctx.set("fileList", vaultFiles);

                const fileCount: Record<string, number> = {};
                for (const file of vaultFiles) {
                    const lc = file.toLowerCase();
                    if (!fileCount[lc]) {
                        fileCount[lc] = 1;
                    } else {
                        fileCount[lc]++;
                    }
                }
                return fileCount;
            }
        );

        const filepath = getStoragePathFromUXFileInfo(file);
        const lc = filepath.toLowerCase();
        if (this.services.vault.shouldCheckCaseInsensitively()) {
            if (lc in fileCount && fileCount[lc] > 1) {
                return false;
            }
        }
        const fileNameLC = getStoragePathFromUXFileInfo(file).split("/").pop()?.toLowerCase();
        if (this.settings.useIgnoreFiles) {
            if (this.ignoreFiles.some((e) => e.toLowerCase() == fileNameLC)) {
                // We must reload ignore files due to the its change.
                await this.readIgnoreFile(filepath);
            }
            if (await this.services.vault.isIgnoredByIgnoreFile(file)) {
                return false;
            }
        }
        if (!this.localDatabase?.isTargetFile(filepath)) return false;
        return true;
    }

    ignoreFileCache = new LRUCache<string, string[] | false>(300, 250000, true);
    ignoreFiles = [] as string[];
    async readIgnoreFile(path: string) {
        try {
            // this._log(`[ignore]Reading ignore file: ${path}`, LOG_LEVEL_VERBOSE);
            if (!(await this.core.storageAccess.isExistsIncludeHidden(path))) {
                this.ignoreFileCache.set(path, false);
                // this._log(`[ignore]Ignore file not found: ${path}`, LOG_LEVEL_VERBOSE);
                return false;
            }
            const file = await this.core.storageAccess.readHiddenFileText(path);
            const gitignore = file.split(/\r?\n/g);
            this.ignoreFileCache.set(path, gitignore);
            this._log(`[ignore]Ignore file loaded: ${path}`, LOG_LEVEL_VERBOSE);
            return gitignore;
        } catch (ex) {
            this._log(`[ignore]Failed to read ignore file ${path}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            this.ignoreFileCache.set(path, false);
            return false;
        }
    }
    async getIgnoreFile(path: string) {
        if (this.ignoreFileCache.has(path)) {
            return this.ignoreFileCache.get(path) ?? false;
        } else {
            return await this.readIgnoreFile(path);
        }
    }
    private async _isIgnoredByIgnoreFiles(file: string | UXFileInfoStub): Promise<boolean> {
        if (!this.settings.useIgnoreFiles) {
            return false;
        }
        const filepath = getStoragePathFromUXFileInfo(file);
        if (this.ignoreFileCache.has(filepath)) {
            // Renew
            await this.readIgnoreFile(filepath);
        }
        if (!(await isAcceptedAll(filepath, this.ignoreFiles, (filename) => this.getIgnoreFile(filename)))) {
            return true;
        }
        return false;
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.vault.markFileListPossiblyChanged.setHandler(this._markFileListPossiblyChanged.bind(this));
        services.appLifecycle.onLoaded.addHandler(this._everyOnload.bind(this));
        services.vault.isIgnoredByIgnoreFile.setHandler(this._isIgnoredByIgnoreFiles.bind(this));
        services.vault.isTargetFile.setHandler(this._isTargetFile.bind(this));
    }
}
