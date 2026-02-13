import { TFile, TFolder, type ListedFiles } from "@/deps.ts";
import { SerializedFileAccess } from "./storageLib/SerializedFileAccess";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import type {
    FilePath,
    FilePathWithPrefix,
    UXDataWriteOptions,
    UXFileInfo,
    UXFileInfoStub,
    UXFolderInfo,
    UXStat,
} from "../../lib/src/common/types";
import { TFileToUXFileInfoStub, TFolderToUXFileInfoStub } from "./storageLib/utilObsidian.ts";
import { StorageEventManagerObsidian, type StorageEventManager } from "./storageLib/StorageEventManager";
import type { StorageAccess } from "../interfaces/StorageAccess";
import { createBlob, type CustomRegExp } from "../../lib/src/common/utils";
import { serialized } from "octagonal-wheels/concurrency/lock_v2";
import type { LiveSyncCore } from "../../main.ts";
import type ObsidianLiveSyncPlugin from "../../main.ts";
import type { InjectableServiceHub } from "../../lib/src/services/InjectableServices.ts";

const fileLockPrefix = "file-lock:";

export class ModuleFileAccessObsidian extends AbstractObsidianModule implements StorageAccess {
    processingFiles: Set<FilePathWithPrefix> = new Set();
    processWriteFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T> {
        const path = typeof file === "string" ? file : file.path;
        return serialized(`${fileLockPrefix}${path}`, async () => {
            try {
                this.processingFiles.add(path);
                return await proc();
            } finally {
                this.processingFiles.delete(path);
            }
        });
    }
    processReadFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T> {
        const path = typeof file === "string" ? file : file.path;
        return serialized(`${fileLockPrefix}${path}`, async () => {
            try {
                this.processingFiles.add(path);
                return await proc();
            } finally {
                this.processingFiles.delete(path);
            }
        });
    }
    isFileProcessing(file: UXFileInfoStub | FilePathWithPrefix): boolean {
        const path = typeof file === "string" ? file : file.path;
        return this.processingFiles.has(path);
    }
    vaultAccess!: SerializedFileAccess;
    vaultManager: StorageEventManager = new StorageEventManagerObsidian(this.plugin, this.core, this);

    restoreState() {
        return this.vaultManager.restoreState();
    }
    async _everyOnFirstInitialize(): Promise<boolean> {
        await this.vaultManager.beginWatch();
        return Promise.resolve(true);
    }

    // $$flushFileEventQueue(): void {
    //     this.vaultManager.flushQueue();
    // }

    async _everyCommitPendingFileEvent(): Promise<boolean> {
        await this.vaultManager.waitForIdle();
        return Promise.resolve(true);
    }

    _everyOnloadStart(): Promise<boolean> {
        this.vaultAccess = new SerializedFileAccess(this.app, this.plugin, this);
        this.core.storageAccess = this;
        return Promise.resolve(true);
    }

    async writeFileAuto(path: string, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<boolean> {
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return this.vaultAccess.vaultModify(file, data, opt);
        } else if (file === null) {
            if (!path.endsWith(".md")) {
                // Very rare case, we encountered this case with `writing-goals-history.csv` file.
                // Indeed, that file not appears in the File Explorer, but it exists in the vault.
                // Hence, we cannot retrieve the file from the vault by getAbstractFileByPath, and we cannot write it via vaultModify.
                // It makes `File already exists` error.
                // Therefore, we need to write it via adapterWrite.
                // Maybe there are others like this, so I will write it via adapterWrite.
                // This is a workaround for the issue, but I don't know if this is the right solution.
                // (So limits to non-md files).
                // Has Obsidian been patched?, anyway, writing directly might be a safer approach.
                // However, does changes of that file trigger file-change event?
                await this.vaultAccess.adapterWrite(path, data, opt);
                // For safety, check existence
                return await this.vaultAccess.adapterExists(path);
            } else {
                return (await this.vaultAccess.vaultCreate(path, data, opt)) instanceof TFile;
            }
        } else {
            this._log(`Could not write file (Possibly already exists as a folder): ${path}`, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    readFileAuto(path: string): Promise<string | ArrayBuffer> {
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return this.vaultAccess.vaultRead(file);
        } else {
            throw new Error(`Could not read file (Possibly does not exist): ${path}`);
        }
    }
    readFileText(path: string): Promise<string> {
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return this.vaultAccess.vaultRead(file);
        } else {
            throw new Error(`Could not read file (Possibly does not exist): ${path}`);
        }
    }
    isExists(path: string): Promise<boolean> {
        return Promise.resolve(this.vaultAccess.getAbstractFileByPath(path) instanceof TFile);
    }
    async writeHiddenFileAuto(path: string, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<boolean> {
        try {
            await this.vaultAccess.adapterWrite(path, data, opt);
            return true;
        } catch (e) {
            this._log(`Could not write hidden file: ${path}`, LOG_LEVEL_VERBOSE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    async appendHiddenFile(path: string, data: string, opt?: UXDataWriteOptions): Promise<boolean> {
        try {
            await this.vaultAccess.adapterAppend(path, data, opt);
            return true;
        } catch (e) {
            this._log(`Could not append hidden file: ${path}`, LOG_LEVEL_VERBOSE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    stat(path: string): Promise<UXStat | null> {
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file === null) return Promise.resolve(null);
        if (file instanceof TFile) {
            return Promise.resolve({
                ctime: file.stat.ctime,
                mtime: file.stat.mtime,
                size: file.stat.size,
                type: "file",
            });
        } else {
            throw new Error(`Could not stat file (Possibly does not exist): ${path}`);
        }
    }
    statHidden(path: string): Promise<UXStat | null> {
        return this.vaultAccess.tryAdapterStat(path);
    }
    async removeHidden(path: string): Promise<boolean> {
        try {
            await this.vaultAccess.adapterRemove(path);
            if (this.vaultAccess.tryAdapterStat(path) !== null) {
                return false;
            }
            return true;
        } catch (e) {
            this._log(`Could not remove hidden file: ${path}`, LOG_LEVEL_VERBOSE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    async readHiddenFileAuto(path: string): Promise<string | ArrayBuffer> {
        return await this.vaultAccess.adapterReadAuto(path);
    }
    async readHiddenFileText(path: string): Promise<string> {
        return await this.vaultAccess.adapterRead(path);
    }
    async readHiddenFileBinary(path: string): Promise<ArrayBuffer> {
        return await this.vaultAccess.adapterReadBinary(path);
    }
    async isExistsIncludeHidden(path: string): Promise<boolean> {
        return (await this.vaultAccess.tryAdapterStat(path)) !== null;
    }
    async ensureDir(path: string): Promise<boolean> {
        try {
            await this.vaultAccess.ensureDirectory(path);
            return true;
        } catch (e) {
            this._log(`Could not ensure directory: ${path}`, LOG_LEVEL_VERBOSE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    triggerFileEvent(event: string, path: string): void {
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file === null) return;
        this.vaultAccess.trigger(event, file);
    }
    async triggerHiddenFile(path: string): Promise<void> {
        //@ts-ignore internal function
        await this.app.vault.adapter.reconcileInternalFile(path);
    }
    // getFileStub(file: TFile): UXFileInfoStub {
    //     return  TFileToUXFileInfoStub(file);
    // }
    getFileStub(path: string): UXFileInfoStub | null {
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return TFileToUXFileInfoStub(file);
        } else {
            return null;
        }
    }

    async readStubContent(stub: UXFileInfoStub): Promise<UXFileInfo | false> {
        const file = this.vaultAccess.getAbstractFileByPath(stub.path);
        if (!(file instanceof TFile)) {
            this._log(`Could not read file (Possibly does not exist or a folder): ${stub.path}`, LOG_LEVEL_VERBOSE);
            return false;
        }
        const data = await this.vaultAccess.vaultReadAuto(file);
        return {
            ...stub,
            ...TFileToUXFileInfoStub(file),
            body: createBlob(data),
        };
    }
    getStub(path: string): UXFileInfoStub | UXFolderInfo | null {
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return TFileToUXFileInfoStub(file);
        } else if (file instanceof TFolder) {
            return TFolderToUXFileInfoStub(file);
        }
        return null;
    }
    getFiles(): UXFileInfoStub[] {
        return this.vaultAccess.getFiles().map((f) => TFileToUXFileInfoStub(f));
    }
    getFileNames(): FilePath[] {
        return this.vaultAccess.getFiles().map((f) => f.path as FilePath);
    }

    async getFilesIncludeHidden(
        basePath: string,
        includeFilter?: CustomRegExp[],
        excludeFilter?: CustomRegExp[],
        skipFolder: string[] = [".git", ".trash", "node_modules"]
    ): Promise<FilePath[]> {
        let w: ListedFiles;
        try {
            w = await this.app.vault.adapter.list(basePath);
        } catch (ex) {
            this._log(`Could not traverse(getFilesIncludeHidden):${basePath}`, LOG_LEVEL_INFO);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
        skipFolder = skipFolder.map((e) => e.toLowerCase());

        let files = [] as string[];
        for (const file of w.files) {
            if (includeFilter && includeFilter.length > 0) {
                if (!includeFilter.some((e) => e.test(file))) continue;
            }
            if (excludeFilter && excludeFilter.some((ee) => ee.test(file))) {
                continue;
            }
            if (await this.services.vault.isIgnoredByIgnoreFile(file)) continue;
            files.push(file);
        }

        for (const v of w.folders) {
            const folderName = (v.split("/").pop() ?? "").toLowerCase();
            if (skipFolder.some((e) => folderName === e)) {
                continue;
            }

            if (excludeFilter && excludeFilter.some((e) => e.test(v))) {
                continue;
            }
            if (await this.services.vault.isIgnoredByIgnoreFile(v)) {
                continue;
            }
            // OK, deep dive!
            files = files.concat(await this.getFilesIncludeHidden(v, includeFilter, excludeFilter, skipFolder));
        }
        return files as FilePath[];
    }
    async touched(file: UXFileInfoStub | FilePathWithPrefix): Promise<void> {
        const path = typeof file === "string" ? file : file.path;
        await this.vaultAccess.touch(path as FilePath);
    }
    recentlyTouched(file: UXFileInfoStub | FilePathWithPrefix): boolean {
        const xFile = typeof file === "string" ? (this.vaultAccess.getAbstractFileByPath(file) as TFile) : file;
        if (xFile === null) return false;
        if (xFile instanceof TFolder) return false;
        return this.vaultAccess.recentlyTouched(xFile);
    }
    clearTouched(): void {
        this.vaultAccess.clearTouched();
    }

    delete(file: FilePathWithPrefix | UXFileInfoStub | string, force: boolean): Promise<void> {
        const xPath = typeof file === "string" ? file : file.path;
        const xFile = this.vaultAccess.getAbstractFileByPath(xPath);
        if (xFile === null) return Promise.resolve();
        if (!(xFile instanceof TFile) && !(xFile instanceof TFolder)) return Promise.resolve();
        return this.vaultAccess.delete(xFile, force);
    }
    trash(file: FilePathWithPrefix | UXFileInfoStub | string, system: boolean): Promise<void> {
        const xPath = typeof file === "string" ? file : file.path;
        const xFile = this.vaultAccess.getAbstractFileByPath(xPath);
        if (xFile === null) return Promise.resolve();
        if (!(xFile instanceof TFile) && !(xFile instanceof TFolder)) return Promise.resolve();
        return this.vaultAccess.trash(xFile, system);
    }
    // $readFileBinary(path: string): Promise<ArrayBuffer> {
    //     const file = this.vaultAccess.getAbstractFileByPath(path);
    //     if (file instanceof TFile) {
    //         return this.vaultAccess.vaultReadBinary(file);
    //     } else {
    //         throw new Error(`Could not read file (Possibly does not exist): ${path}`);
    //     }
    // }
    // async $appendFileAuto(path: string, data: string | ArrayBuffer, opt?: DataWriteOptions): Promise<boolean> {
    //     const file = this.vaultAccess.getAbstractFileByPath(path);
    //     if (file instanceof TFile) {
    //         return this.vaultAccess.a(file, data, opt);
    //     } else if (file !== null) {
    //         return await this.vaultAccess.vaultCreate(path, data, opt) instanceof TFile;
    //     } else {
    //         this._log(`Could not append file (Possibly already exists as a folder): ${path}`, LOG_LEVEL_VERBOSE);
    //         return false;
    //     }
    // }

    async __deleteVaultItem(file: TFile | TFolder) {
        if (file instanceof TFile) {
            if (!(await this.services.vault.isTargetFile(file.path))) return;
        }
        const dir = file.parent;
        if (this.settings.trashInsteadDelete) {
            await this.vaultAccess.trash(file, false);
        } else {
            await this.vaultAccess.delete(file, true);
        }
        this._log(`xxx <- STORAGE (deleted) ${file.path}`);
        if (dir) {
            this._log(`files: ${dir.children.length}`);
            if (dir.children.length == 0) {
                if (!this.settings.doNotDeleteFolder) {
                    this._log(
                        `All files under the parent directory (${dir.path}) have been deleted, so delete this one.`
                    );
                    await this.__deleteVaultItem(dir);
                }
            }
        }
    }

    async deleteVaultItem(fileSrc: FilePathWithPrefix | UXFileInfoStub | UXFolderInfo): Promise<void> {
        const path = typeof fileSrc === "string" ? fileSrc : fileSrc.path;
        const file = this.vaultAccess.getAbstractFileByPath(path);
        if (file === null) return;
        if (file instanceof TFile || file instanceof TFolder) {
            return await this.__deleteVaultItem(file);
        }
    }

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore) {
        super(plugin, core);
    }
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.appLifecycle.onFirstInitialise.addHandler(this._everyOnFirstInitialize.bind(this));
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.fileProcessing.commitPendingFileEvents.addHandler(this._everyCommitPendingFileEvent.bind(this));
    }
}
