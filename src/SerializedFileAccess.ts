import { type App, TFile, type DataWriteOptions, TFolder, TAbstractFile } from "./deps";
import { serialized } from "./lib/src/lock";
import { Logger } from "./lib/src/logger";
import { isPlainText } from "./lib/src/path";
import type { FilePath } from "./lib/src/types";
import { createBinaryBlob, isDocContentSame } from "./lib/src/utils";
import type { InternalFileInfo } from "./types";
import { markChangesAreSame } from "./utils";

function getFileLockKey(file: TFile | TFolder | string) {
    return `fl:${typeof (file) == "string" ? file : file.path}`;
}
function toArrayBuffer(arr: Uint8Array | ArrayBuffer | DataView): ArrayBufferLike {
    if (arr instanceof Uint8Array) {
        return arr.buffer;
    }
    if (arr instanceof DataView) {
        return arr.buffer;
    }
    return arr;
}


async function processReadFile<T>(file: TFile | TFolder | string, proc: () => Promise<T>) {
    const ret = await serialized(getFileLockKey(file), () => proc());
    return ret;
}
async function processWriteFile<T>(file: TFile | TFolder | string, proc: () => Promise<T>) {
    const ret = await serialized(getFileLockKey(file), () => proc());
    return ret;
}
export class SerializedFileAccess {
    app: App
    constructor(app: App) {
        this.app = app;
    }

    async adapterStat(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await processReadFile(file, () => this.app.vault.adapter.stat(path));
    }
    async adapterExists(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await processReadFile(file, () => this.app.vault.adapter.exists(path));
    }
    async adapterRemove(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await processReadFile(file, () => this.app.vault.adapter.remove(path));
    }

    async adapterRead(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await processReadFile(file, () => this.app.vault.adapter.read(path));
    }
    async adapterReadBinary(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await processReadFile(file, () => this.app.vault.adapter.readBinary(path));
    }

    async adapterReadAuto(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        if (isPlainText(path)) return await processReadFile(file, () => this.app.vault.adapter.read(path));
        return await processReadFile(file, () => this.app.vault.adapter.readBinary(path));
    }

    async adapterWrite(file: TFile | string, data: string | ArrayBuffer | Uint8Array, options?: DataWriteOptions) {
        const path = file instanceof TFile ? file.path : file;
        if (typeof (data) === "string") {
            return await processWriteFile(file, () => this.app.vault.adapter.write(path, data, options));
        } else {
            return await processWriteFile(file, () => this.app.vault.adapter.writeBinary(path, toArrayBuffer(data), options));
        }
    }

    async vaultCacheRead(file: TFile) {
        return await processReadFile(file, () => this.app.vault.cachedRead(file));
    }

    async vaultRead(file: TFile) {
        return await processReadFile(file, () => this.app.vault.read(file));
    }

    async vaultReadBinary(file: TFile) {
        return await processReadFile(file, () => this.app.vault.readBinary(file));
    }

    async vaultReadAuto(file: TFile) {
        const path = file.path;
        if (isPlainText(path)) return await processReadFile(file, () => this.app.vault.read(file));
        return await processReadFile(file, () => this.app.vault.readBinary(file));
    }


    async vaultModify(file: TFile, data: string | ArrayBuffer | Uint8Array, options?: DataWriteOptions) {
        if (typeof (data) === "string") {
            return await processWriteFile(file, async () => {
                const oldData = await this.app.vault.read(file);
                if (data === oldData) {
                    if (options && options.mtime) markChangesAreSame(file, file.stat.mtime, options.mtime);
                    return false
                }
                await this.app.vault.modify(file, data, options)
                return true;
            }
            );
        } else {
            return await processWriteFile(file, async () => {
                const oldData = await this.app.vault.readBinary(file);
                if (await isDocContentSame(createBinaryBlob(oldData), createBinaryBlob(data))) {
                    if (options && options.mtime) markChangesAreSame(file, file.stat.mtime, options.mtime);
                    return false;
                }
                await this.app.vault.modifyBinary(file, toArrayBuffer(data), options)
                return true;
            });
        }
    }
    async vaultCreate(path: string, data: string | ArrayBuffer | Uint8Array, options?: DataWriteOptions): Promise<TFile> {
        if (typeof (data) === "string") {
            return await processWriteFile(path, () => this.app.vault.create(path, data, options));
        } else {
            return await processWriteFile(path, () => this.app.vault.createBinary(path, toArrayBuffer(data), options));
        }
    }

    trigger(name: string, ...data: any[]) {
        return this.app.vault.trigger(name, ...data);
    }

    async adapterAppend(normalizedPath: string, data: string, options?: DataWriteOptions) {
        return await this.app.vault.adapter.append(normalizedPath, data, options)
    }

    async delete(file: TFile | TFolder, force = false) {
        return await processWriteFile(file, () => this.app.vault.delete(file, force));
    }
    async trash(file: TFile | TFolder, force = false) {
        return await processWriteFile(file, () => this.app.vault.trash(file, force));
    }

    getAbstractFileByPath(path: FilePath | string): TAbstractFile | null {
        // Disabled temporary.
        return this.app.vault.getAbstractFileByPath(path);
        // // Hidden API but so useful.
        // // @ts-ignore
        // if ("getAbstractFileByPathInsensitive" in app.vault && (app.vault.adapter?.insensitive ?? false)) {
        //     // @ts-ignore
        //     return app.vault.getAbstractFileByPathInsensitive(path);
        // } else {
        //    return app.vault.getAbstractFileByPath(path);
        // }
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


    touch(file: TFile | FilePath) {
        const f = file instanceof TFile ? file : this.getAbstractFileByPath(file) as TFile;
        const key = `${f.path}-${f.stat.mtime}-${f.stat.size}`;
        this.touchedFiles.unshift(key);
        this.touchedFiles = this.touchedFiles.slice(0, 100);
    }
    recentlyTouched(file: TFile | InternalFileInfo) {
        const key = file instanceof TFile ? `${file.path}-${file.stat.mtime}-${file.stat.size}` : `${file.path}-${file.mtime}-${file.size}`;
        if (this.touchedFiles.indexOf(key) == -1) return false;
        return true;
    }
    clearTouched() {
        this.touchedFiles = [];
    }
}