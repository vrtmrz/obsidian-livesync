import { LRUCache } from "octagonal-wheels/memory/LRUCache";
import {
    getPathFromUXFileInfo,
    id2path,
    isInternalMetadata,
    path2id,
    stripInternalMetadataPrefix,
    useMemo,
} from "../../common/utils";
import {
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type EntryHasPath,
    type FilePath,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
    type UXFileInfoStub,
} from "../../lib/src/common/types";
import { addPrefix, isAcceptedAll, stripAllPrefixes } from "../../lib/src/string_and_binary/path";
import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import { isDirty } from "../../lib/src/common/utils";
export class ModuleTargetFilter extends AbstractModule implements ICoreModule {
    reloadIgnoreFiles() {
        this.ignoreFiles = this.settings.ignoreFiles.split(",").map((e) => e.trim());
    }
    $everyOnload(): Promise<boolean> {
        eventHub.onEvent(EVENT_SETTING_SAVED, (evt: ObsidianLiveSyncSettings) => {
            this.reloadIgnoreFiles();
        });
        eventHub.onEvent(EVENT_REQUEST_RELOAD_SETTING_TAB, () => {
            this.reloadIgnoreFiles();
        });
        return Promise.resolve(true);
    }

    $$id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        const tempId = id2path(id, entry);
        if (stripPrefix && isInternalMetadata(tempId)) {
            const out = stripInternalMetadataPrefix(tempId);
            return out;
        }
        return tempId;
    }
    async $$path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        const destPath = addPrefix(filename, prefix ?? "");
        return await path2id(
            destPath,
            this.settings.usePathObfuscation ? this.settings.passphrase : "",
            !this.settings.handleFilenameCaseSensitive
        );
    }

    $$isFileSizeExceeded(size: number) {
        if (this.settings.syncMaxSizeInMB > 0 && size > 0) {
            if (this.settings.syncMaxSizeInMB * 1024 * 1024 < size) {
                return true;
            }
        }
        return false;
    }

    $$markFileListPossiblyChanged(): void {
        this.totalFileEventCount++;
    }
    totalFileEventCount = 0;
    get fileListPossiblyChanged() {
        if (isDirty("totalFileEventCount", this.totalFileEventCount)) {
            return true;
        }
        return false;
    }

    async $$isTargetFile(file: string | UXFileInfoStub, keepFileCheckList = false) {
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

        const filepath = getPathFromUXFileInfo(file);
        const lc = filepath.toLowerCase();
        if (this.core.$$shouldCheckCaseInsensitive()) {
            if (lc in fileCount && fileCount[lc] > 1) {
                return false;
            }
        }
        const fileNameLC = getPathFromUXFileInfo(file).split("/").pop()?.toLowerCase();
        if (this.settings.useIgnoreFiles) {
            if (this.ignoreFiles.some((e) => e.toLowerCase() == fileNameLC)) {
                // We must reload ignore files due to the its change.
                await this.readIgnoreFile(filepath);
            }
            if (await this.core.$$isIgnoredByIgnoreFiles(file)) {
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
            const file = await this.core.storageAccess.readFileText(path);
            const gitignore = file.split(/\r?\n/g);
            this.ignoreFileCache.set(path, gitignore);
            return gitignore;
        } catch (ex) {
            this._log(`Failed to read ignore file ${path}`);
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
    async $$isIgnoredByIgnoreFiles(file: string | UXFileInfoStub): Promise<boolean> {
        if (!this.settings.useIgnoreFiles) {
            return false;
        }
        const filepath = getPathFromUXFileInfo(file);
        if (this.ignoreFileCache.has(filepath)) {
            // Renew
            await this.readIgnoreFile(filepath);
        }
        if (
            !(await isAcceptedAll(stripAllPrefixes(filepath), this.ignoreFiles, (filename) =>
                this.getIgnoreFile(filename)
            ))
        ) {
            return true;
        }
        return false;
    }
}
