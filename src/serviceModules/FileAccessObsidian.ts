import { markChangesAreSame } from "@/common/utils";
import type { FilePath, UXDataWriteOptions, UXFileInfoStub, UXFolderInfo } from "@lib/common/types";

import { TFolder, type TAbstractFile, TFile, type Stat, type App, type DataWriteOptions, normalizePath } from "@/deps";
import { FileAccessBase, toArrayBuffer, type FileAccessBaseDependencies } from "@lib/serviceModules/FileAccessBase.ts";
import { TFileToUXFileInfoStub } from "@/modules/coreObsidian/storageLib/utilObsidian";

declare module "obsidian" {
    interface Vault {
        getAbstractFileByPathInsensitive(path: string): TAbstractFile | null;
    }
    interface DataAdapter {
        reconcileInternalFile?(path: string): Promise<void>;
    }
}

export class FileAccessObsidian extends FileAccessBase<TAbstractFile, TFile, TFolder, Stat> {
    app: App;

    override getPath(file: string | TAbstractFile): FilePath {
        return (typeof file === "string" ? file : file.path) as FilePath;
    }

    override isFile(file: TAbstractFile | null): file is TFile {
        return file instanceof TFile;
    }
    override isFolder(file: TAbstractFile | null): file is TFolder {
        return file instanceof TFolder;
    }
    override _statFromNative(file: TFile): Promise<TFile["stat"]> {
        return Promise.resolve(file.stat);
    }

    override nativeFileToUXFileInfoStub(file: TFile): UXFileInfoStub {
        return TFileToUXFileInfoStub(file);
    }
    override nativeFolderToUXFolder(folder: TFolder): UXFolderInfo {
        if (folder instanceof TFolder) {
            return this.nativeFolderToUXFolder(folder);
        } else {
            throw new Error(`Not a folder: ${(folder as TAbstractFile)?.name}`);
        }
    }

    constructor(app: App, dependencies: FileAccessBaseDependencies) {
        super({
            storageAccessManager: dependencies.storageAccessManager,
            vaultService: dependencies.vaultService,
            settingService: dependencies.settingService,
            APIService: dependencies.APIService,
        });
        this.app = app;
    }

    protected override _normalisePath(path: string): string {
        return normalizePath(path);
    }

    protected async _adapterMkdir(path: string) {
        await this.app.vault.adapter.mkdir(path);
    }
    protected _getAbstractFileByPath(path: FilePath) {
        return this.app.vault.getAbstractFileByPath(path);
    }
    protected _getAbstractFileByPathInsensitive(path: FilePath) {
        return this.app.vault.getAbstractFileByPathInsensitive(path);
    }

    protected async _tryAdapterStat(path: FilePath) {
        if (!(await this.app.vault.adapter.exists(path))) return null;
        return await this.app.vault.adapter.stat(path);
    }

    protected async _adapterStat(path: FilePath) {
        return await this.app.vault.adapter.stat(path);
    }

    protected async _adapterExists(path: FilePath) {
        return await this.app.vault.adapter.exists(path);
    }
    protected async _adapterRemove(path: FilePath) {
        await this.app.vault.adapter.remove(path);
    }

    protected async _adapterRead(path: FilePath) {
        return await this.app.vault.adapter.read(path);
    }

    protected async _adapterReadBinary(path: FilePath) {
        return await this.app.vault.adapter.readBinary(path);
    }

    _adapterWrite(file: string, data: string, options?: UXDataWriteOptions): Promise<void> {
        return this.app.vault.adapter.write(file, data, options);
    }
    _adapterWriteBinary(file: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        return this.app.vault.adapter.writeBinary(file, toArrayBuffer(data), options);
    }

    protected _adapterList(basePath: string): Promise<{ files: string[]; folders: string[] }> {
        return Promise.resolve(this.app.vault.adapter.list(basePath));
    }

    async _vaultCacheRead(file: TFile) {
        return await this.app.vault.cachedRead(file);
    }

    protected async _vaultRead(file: TFile): Promise<string> {
        return await this.app.vault.read(file);
    }

    protected async _vaultReadBinary(file: TFile): Promise<ArrayBuffer> {
        return await this.app.vault.readBinary(file);
    }

    protected override markChangesAreSame(path: string, mtime: number, newMtime: number) {
        return markChangesAreSame(path, mtime, newMtime);
    }

    protected override async _vaultModify(file: TFile, data: string, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.modify(file, data, options);
    }
    protected override async _vaultModifyBinary(
        file: TFile,
        data: ArrayBuffer,
        options?: UXDataWriteOptions
    ): Promise<void> {
        return await this.app.vault.modifyBinary(file, toArrayBuffer(data), options);
    }
    protected override async _vaultCreate(path: string, data: string, options?: UXDataWriteOptions): Promise<TFile> {
        return await this.app.vault.create(path, data, options);
    }
    protected override async _vaultCreateBinary(
        path: string,
        data: ArrayBuffer,
        options?: UXDataWriteOptions
    ): Promise<TFile> {
        return await this.app.vault.createBinary(path, toArrayBuffer(data), options);
    }

    protected override _trigger(name: string, ...data: any[]) {
        return this.app.vault.trigger(name, ...data);
    }
    protected override async _reconcileInternalFile(path: string) {
        return await Promise.resolve(this.app.vault.adapter.reconcileInternalFile?.(path));
    }
    protected override async _adapterAppend(normalizedPath: string, data: string, options?: DataWriteOptions) {
        return await this.app.vault.adapter.append(normalizedPath, data, options);
    }
    protected override async _delete(file: TFile | TFolder, force = false) {
        return await this.app.vault.delete(file, force);
    }
    protected override async _trash(file: TFile | TFolder, force = false) {
        return await this.app.vault.trash(file, force);
    }

    protected override _getFiles() {
        return this.app.vault.getFiles();
    }
}
