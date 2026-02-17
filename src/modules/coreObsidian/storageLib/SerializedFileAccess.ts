import { type App, TFile, type DataWriteOptions, TFolder, TAbstractFile } from "../../../deps.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { isPlainText } from "../../../lib/src/string_and_binary/path.ts";
import type { FilePath, UXFileInfoStub } from "../../../lib/src/common/types.ts";
import { createBinaryBlob, isDocContentSame } from "../../../lib/src/common/utils.ts";
import type { InternalFileInfo } from "../../../common/types.ts";
import { markChangesAreSame } from "../../../common/utils.ts";
import type { IStorageAccessManager } from "@lib/interfaces/StorageAccess.ts";
import type { LiveSyncCore } from "@/main.ts";
function toArrayBuffer(arr: Uint8Array<ArrayBuffer> | ArrayBuffer | DataView<ArrayBuffer>): ArrayBuffer {
    if (arr instanceof Uint8Array) {
        return arr.buffer;
    }
    if (arr instanceof DataView) {
        return arr.buffer;
    }
    return arr;
}
// TODO: add abstraction for the file access (as wrapping TFile or something similar)
export abstract class FileAccessBase<TNativeFile> {
    storageAccessManager: IStorageAccessManager;
    constructor(storageAccessManager: IStorageAccessManager) {
        this.storageAccessManager = storageAccessManager;
    }
    abstract getPath(file: TNativeFile | string): FilePath;
}

export class ObsidianFileAccess extends FileAccessBase<TFile> {
    app: App;
    plugin: LiveSyncCore;

    getPath(file: string | TFile): FilePath {
        return (typeof file === "string" ? file : file.path) as FilePath;
    }

    constructor(app: App, plugin: LiveSyncCore, storageAccessManager: IStorageAccessManager) {
        super(storageAccessManager);
        this.app = app;
        this.plugin = plugin;
    }

    async tryAdapterStat(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await this.storageAccessManager.processReadFile(path as FilePath, async () => {
            if (!(await this.app.vault.adapter.exists(path))) return null;
            return this.app.vault.adapter.stat(path);
        });
    }
    async adapterStat(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await this.storageAccessManager.processReadFile(path as FilePath, () =>
            this.app.vault.adapter.stat(path)
        );
    }
    async adapterExists(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await this.storageAccessManager.processReadFile(path as FilePath, () =>
            this.app.vault.adapter.exists(path)
        );
    }
    async adapterRemove(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await this.storageAccessManager.processWriteFile(path as FilePath, () =>
            this.app.vault.adapter.remove(path)
        );
    }

    async adapterRead(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await this.storageAccessManager.processReadFile(path as FilePath, () =>
            this.app.vault.adapter.read(path)
        );
    }
    async adapterReadBinary(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await this.storageAccessManager.processReadFile(path as FilePath, () =>
            this.app.vault.adapter.readBinary(path)
        );
    }

    async adapterReadAuto(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        if (isPlainText(path)) {
            return await this.storageAccessManager.processReadFile(path as FilePath, () =>
                this.app.vault.adapter.read(path)
            );
        }
        return await this.storageAccessManager.processReadFile(path as FilePath, () =>
            this.app.vault.adapter.readBinary(path)
        );
    }

    async adapterWrite(
        file: TFile | string,
        data: string | ArrayBuffer | Uint8Array<ArrayBuffer>,
        options?: DataWriteOptions
    ) {
        const path = file instanceof TFile ? file.path : file;
        if (typeof data === "string") {
            return await this.storageAccessManager.processWriteFile(path as FilePath, () =>
                this.app.vault.adapter.write(path, data, options)
            );
        } else {
            return await this.storageAccessManager.processWriteFile(path as FilePath, () =>
                this.app.vault.adapter.writeBinary(path, toArrayBuffer(data), options)
            );
        }
    }

    adapterList(basePath: string): Promise<{ files: string[]; folders: string[] }> {
        return Promise.resolve(this.app.vault.adapter.list(basePath));
    }

    async vaultCacheRead(file: TFile) {
        return await this.storageAccessManager.processReadFile(file.path as FilePath, () =>
            this.app.vault.cachedRead(file)
        );
    }

    async vaultRead(file: TFile) {
        return await this.storageAccessManager.processReadFile(file.path as FilePath, () => this.app.vault.read(file));
    }

    async vaultReadBinary(file: TFile) {
        return await this.storageAccessManager.processReadFile(file.path as FilePath, () =>
            this.app.vault.readBinary(file)
        );
    }

    async vaultReadAuto(file: TFile) {
        const path = file.path;
        if (isPlainText(path)) {
            return await this.storageAccessManager.processReadFile(path as FilePath, () => this.app.vault.read(file));
        }
        return await this.storageAccessManager.processReadFile(path as FilePath, () => this.app.vault.readBinary(file));
    }

    async vaultModify(file: TFile, data: string | ArrayBuffer | Uint8Array<ArrayBuffer>, options?: DataWriteOptions) {
        if (typeof data === "string") {
            return await this.storageAccessManager.processWriteFile(file.path as FilePath, async () => {
                const oldData = await this.app.vault.read(file);
                if (data === oldData) {
                    if (options && options.mtime) markChangesAreSame(file.path, file.stat.mtime, options.mtime);
                    return true;
                }
                await this.app.vault.modify(file, data, options);
                return true;
            });
        } else {
            return await this.storageAccessManager.processWriteFile(file.path as FilePath, async () => {
                const oldData = await this.app.vault.readBinary(file);
                if (await isDocContentSame(createBinaryBlob(oldData), createBinaryBlob(data))) {
                    if (options && options.mtime) markChangesAreSame(file.path, file.stat.mtime, options.mtime);
                    return true;
                }
                await this.app.vault.modifyBinary(file, toArrayBuffer(data), options);
                return true;
            });
        }
    }
    async vaultCreate(
        path: string,
        data: string | ArrayBuffer | Uint8Array<ArrayBuffer>,
        options?: DataWriteOptions
    ): Promise<TFile> {
        if (typeof data === "string") {
            return await this.storageAccessManager.processWriteFile(path as FilePath, () =>
                this.app.vault.create(path, data, options)
            );
        } else {
            return await this.storageAccessManager.processWriteFile(path as FilePath, () =>
                this.app.vault.createBinary(path, toArrayBuffer(data), options)
            );
        }
    }

    trigger(name: string, ...data: any[]) {
        return this.app.vault.trigger(name, ...data);
    }
    async reconcileInternalFile(path: string) {
        await (this.app.vault.adapter as any)?.reconcileInternalFile(path);
    }

    async adapterAppend(normalizedPath: string, data: string, options?: DataWriteOptions) {
        return await this.app.vault.adapter.append(normalizedPath, data, options);
    }

    async delete(file: TFile | TFolder, force = false) {
        return await this.storageAccessManager.processWriteFile(file.path as FilePath, () =>
            this.app.vault.delete(file, force)
        );
    }
    async trash(file: TFile | TFolder, force = false) {
        return await this.storageAccessManager.processWriteFile(file.path as FilePath, () =>
            this.app.vault.trash(file, force)
        );
    }

    isStorageInsensitive(): boolean {
        return this.plugin.services.vault.isStorageInsensitive();
    }

    getAbstractFileByPathInsensitive(path: FilePath | string): TAbstractFile | null {
        //@ts-ignore
        return this.app.vault.getAbstractFileByPathInsensitive(path);
    }

    getAbstractFileByPath(path: FilePath | string): TAbstractFile | null {
        if (!this.plugin.settings.handleFilenameCaseSensitive || this.isStorageInsensitive()) {
            return this.getAbstractFileByPathInsensitive(path);
        }
        return this.app.vault.getAbstractFileByPath(path);
    }

    getFiles() {
        return this.app.vault.getFiles();
    }

    async ensureDirectory(fullPath: string) {
        const pathElements = fullPath.split("/");
        pathElements.pop();
        let c = "";
        for (const v of pathElements) {
            c += v;
            try {
                await this.app.vault.adapter.mkdir(c);
            } catch (ex: any) {
                if (ex?.message == "Folder already exists.") {
                    // Skip if already exists.
                } else {
                    Logger("Folder Create Error");
                    Logger(ex);
                }
            }
            c += "/";
        }
    }

    touchedFiles: string[] = [];

    _statInternal(file: FilePath) {
        return this.app.vault.adapter.stat(file);
    }

    async touch(file: TFile | FilePath) {
        const path = file instanceof TFile ? (file.path as FilePath) : file;
        const statOrg = file instanceof TFile ? file.stat : await this._statInternal(path);
        const stat = statOrg || { mtime: 0, size: 0 };
        const key = `${path}-${stat.mtime}-${stat.size}`;
        this.touchedFiles.unshift(key);
        this.touchedFiles = this.touchedFiles.slice(0, 100);
    }
    recentlyTouched(file: TFile | InternalFileInfo | UXFileInfoStub) {
        const key =
            "stat" in file
                ? `${file.path}-${file.stat.mtime}-${file.stat.size}`
                : `${file.path}-${file.mtime}-${file.size}`;
        if (this.touchedFiles.indexOf(key) == -1) return false;
        return true;
    }
    clearTouched() {
        this.touchedFiles = [];
    }
}
