import { getStoragePathFromUXFileInfo } from "../../common/utils";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_VERBOSE, type UXFileInfoStub } from "../../lib/src/common/types";
import { isAcceptedAll } from "../../lib/src/string_and_binary/path";
import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../main";
import { Computed } from "octagonal-wheels/dataobject/Computed";
export class ModuleTargetFilter extends AbstractModule {
    ignoreFiles: string[] = [];
    private refreshSettings() {
        this.ignoreFiles = this.settings.ignoreFiles.split(",").map((e) => e.trim());
        return Promise.resolve(true);
    }

    private _everyOnload(): Promise<boolean> {
        void this.refreshSettings();
        return Promise.resolve(true);
    }

    _markFileListPossiblyChanged(): void {
        this.totalFileEventCount++;
    }

    fileCountMap = new Computed({
        evaluation: (fileEventCount: number) => {
            const vaultFiles = this.core.storageAccess.getFileNames().sort();
            const fileCountMap: Record<string, number> = {};
            for (const file of vaultFiles) {
                const lc = file.toLowerCase();
                if (!fileCountMap[lc]) {
                    fileCountMap[lc] = 1;
                } else {
                    fileCountMap[lc]++;
                }
            }
            return fileCountMap;
        },
        requiresUpdate: (args, previousArgs, previousResult) => {
            if (!previousResult) return true;
            if (previousResult instanceof Error) return true;
            if (!previousArgs) return true;
            if (args[0] === previousArgs[0]) {
                return false;
            }
            return true;
        },
    });

    totalFileEventCount = 0;

    private async _isTargetFileByFileNameDuplication(file: string | UXFileInfoStub) {
        await this.fileCountMap.updateValue(this.totalFileEventCount);
        const fileCountMap = this.fileCountMap.value;
        if (!fileCountMap) {
            this._log("File count map is not ready yet.");
            return false;
        }

        const filepath = getStoragePathFromUXFileInfo(file);
        const lc = filepath.toLowerCase();
        if (this.services.vault.shouldCheckCaseInsensitively()) {
            if (lc in fileCountMap && fileCountMap[lc] > 1) {
                this._log("File is duplicated (case-insensitive): " + filepath);
                return false;
            }
        }
        this._log("File is not duplicated: " + filepath, LOG_LEVEL_DEBUG);
        return true;
    }

    private ignoreFileCacheMap = new Map<string, string[] | undefined | false>();

    private invalidateIgnoreFileCache(path: string) {
        // This erases `/path/to/.ignorefile` from cache, therefore, next access will reload it.
        // When detecting edited the ignore file, this method should be called.
        // Do not check whether it exists in cache or not; just delete it.
        const key = path.toLowerCase();
        this.ignoreFileCacheMap.delete(key);
    }
    private async getIgnoreFile(path: string): Promise<string[] | false> {
        const key = path.toLowerCase();
        const cached = this.ignoreFileCacheMap.get(key);
        if (cached !== undefined) {
            // if cached is not undefined, cache hit (neither exists or not exists, string[] or false).
            return cached;
        }
        try {
            // load the ignore file
            if (!(await this.core.storageAccess.isExistsIncludeHidden(path))) {
                // file does not exist, cache as not exists
                this.ignoreFileCacheMap.set(key, false);
                return false;
            }
            const file = await this.core.storageAccess.readHiddenFileText(path);
            const gitignore = file
                .split(/\r?\n/g)
                .map((e) => e.replace(/\r$/, ""))
                .map((e) => e.trim());
            this.ignoreFileCacheMap.set(key, gitignore);
            this._log(`[ignore] Ignore file loaded: ${path}`, LOG_LEVEL_VERBOSE);
            return gitignore;
        } catch (ex) {
            // Failed to read the ignore file, delete cache.
            this._log(`[ignore] Failed to read ignore file ${path}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            this.ignoreFileCacheMap.set(key, undefined);
            return false;
        }
    }

    private async _isTargetFileByLocalDB(file: string | UXFileInfoStub) {
        const filepath = getStoragePathFromUXFileInfo(file);
        if (!this.localDatabase?.isTargetFile(filepath)) {
            this._log("File is not target by local DB: " + filepath);
            return false;
        }
        this._log("File is target by local DB: " + filepath, LOG_LEVEL_DEBUG);
        return await Promise.resolve(true);
    }

    private async _isTargetFileFinal(file: string | UXFileInfoStub) {
        this._log("File is target finally: " + getStoragePathFromUXFileInfo(file), LOG_LEVEL_DEBUG);
        return await Promise.resolve(true);
    }

    private async _isTargetIgnoredByIgnoreFiles(file: string | UXFileInfoStub): Promise<boolean> {
        if (!this.settings.useIgnoreFiles) {
            return true;
        }
        const filepath = getStoragePathFromUXFileInfo(file);
        this.invalidateIgnoreFileCache(filepath);
        this._log("Checking ignore files for: " + filepath, LOG_LEVEL_DEBUG);
        if (!(await isAcceptedAll(filepath, this.ignoreFiles, (filename) => this.getIgnoreFile(filename)))) {
            this._log("File is ignored by ignore files: " + filepath);
            return false;
        }
        this._log("File is not ignored by ignore files: " + filepath, LOG_LEVEL_DEBUG);
        return true;
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.vault.markFileListPossiblyChanged.setHandler(this._markFileListPossiblyChanged.bind(this));
        services.appLifecycle.onLoaded.addHandler(this._everyOnload.bind(this));
        services.vault.isIgnoredByIgnoreFile.setHandler(this._isTargetIgnoredByIgnoreFiles.bind(this));
        services.vault.isTargetFile.addHandler(this._isTargetFileByFileNameDuplication.bind(this));
        services.vault.isTargetFile.addHandler(this._isTargetIgnoredByIgnoreFiles.bind(this));
        services.vault.isTargetFile.addHandler(this._isTargetFileByLocalDB.bind(this));
        services.vault.isTargetFile.addHandler(this._isTargetFileFinal.bind(this));
        services.setting.onSettingRealised.addHandler(this.refreshSettings.bind(this));
    }
}
