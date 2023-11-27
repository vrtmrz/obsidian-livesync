import { type App, TFile, type DataWriteOptions, TFolder, TAbstractFile } from "./deps";
import { serialized } from "./lib/src/lock";
import type { FilePath } from "./lib/src/types";
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

export class SerializedFileAccess {
    app: App
    constructor(app: App) {
        this.app = app;
    }

    async adapterStat(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await serialized(getFileLockKey(path), () => this.app.vault.adapter.stat(path));
    }
    async adapterExists(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await serialized(getFileLockKey(path), () => this.app.vault.adapter.exists(path));
    }
    async adapterRemove(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await serialized(getFileLockKey(path), () => this.app.vault.adapter.remove(path));
    }

    async adapterRead(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await serialized(getFileLockKey(path), () => this.app.vault.adapter.read(path));
    }
    async adapterReadBinary(file: TFile | string) {
        const path = file instanceof TFile ? file.path : file;
        return await serialized(getFileLockKey(path), () => this.app.vault.adapter.readBinary(path));
    }

    async adapterWrite(file: TFile | string, data: string | ArrayBuffer | Uint8Array, options?: DataWriteOptions) {
        const path = file instanceof TFile ? file.path : file;
        if (typeof (data) === "string") {
            return await serialized(getFileLockKey(path), () => this.app.vault.adapter.write(path, data, options));
        } else {
            return await serialized(getFileLockKey(path), () => this.app.vault.adapter.writeBinary(path, toArrayBuffer(data), options));
        }
    }

    async vaultCacheRead(file: TFile) {
        return await serialized(getFileLockKey(file), () => this.app.vault.cachedRead(file));
    }

    async vaultRead(file: TFile) {
        return await serialized(getFileLockKey(file), () => this.app.vault.read(file));
    }

    async vaultReadBinary(file: TFile) {
        return await serialized(getFileLockKey(file), () => this.app.vault.readBinary(file));
    }

    async vaultModify(file: TFile, data: string | ArrayBuffer | Uint8Array, options?: DataWriteOptions) {
        if (typeof (data) === "string") {
            return await serialized(getFileLockKey(file), () => this.app.vault.modify(file, data, options));
        } else {
            return await serialized(getFileLockKey(file), () => this.app.vault.modifyBinary(file, toArrayBuffer(data), options));
        }
    }
    async vaultCreate(path: string, data: string | ArrayBuffer | Uint8Array, options?: DataWriteOptions): Promise<TFile> {
        if (typeof (data) === "string") {
            return await serialized(getFileLockKey(path), () => this.app.vault.create(path, data, options));
        } else {
            return await serialized(getFileLockKey(path), () => this.app.vault.createBinary(path, toArrayBuffer(data), options));
        }
    }
    async delete(file: TFile | TFolder, force = false) {
        return await serialized(getFileLockKey(file), () => this.app.vault.delete(file, force));
    }
    async trash(file: TFile | TFolder, force = false) {
        return await serialized(getFileLockKey(file), () => this.app.vault.trash(file, force));
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


    touchedFiles: string[] = [];


    touch(file: TFile | FilePath) {
        const f = file instanceof TFile ? file : this.getAbstractFileByPath(file) as TFile;
        const key = `${f.path}-${f.stat.mtime}-${f.stat.size}`;
        this.touchedFiles.unshift(key);
        this.touchedFiles = this.touchedFiles.slice(0, 100);
    }
    recentlyTouched(file: TFile) {
        const key = `${file.path}-${file.stat.mtime}-${file.stat.size}`;
        if (this.touchedFiles.indexOf(key) == -1) return false;
        return true;
    }
    clearTouched() {
        this.touchedFiles = [];
    }
}