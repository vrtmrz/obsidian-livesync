import {
    FilePathIndex,
    type FileNameLookup,
    type FileNameReadOptions,
    type FilePath,
    type PathComparisonSettings,
} from "@vrtmrz/livesync-commonlib/storage";
import type { EventRef, TAbstractFile, TFolder, Vault } from "obsidian";

function isFolder(file: TAbstractFile): file is TFolder {
    return "children" in file;
}

function isInsideFolder(path: FilePath, folderPath: string): boolean {
    return path.startsWith(`${folderPath}/`);
}

/** Maintains file-name membership from Obsidian's in-memory Vault listing and events. */
export class ObsidianFileNameSource implements FileNameLookup {
    private readonly index = new FilePathIndex();
    private readonly eventRefs: EventRef[] = [];
    private disposed = false;

    constructor(private readonly vault: Vault) {
        try {
            this.eventRefs.push(this.vault.on("create", this.onCreate));
            this.eventRefs.push(this.vault.on("delete", this.onDelete));
            this.eventRefs.push(this.vault.on("rename", this.onRename));
            this.index.replaceAll(this.getVaultFileNames());
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    async getFileNames(options?: FileNameReadOptions): Promise<FilePath[]> {
        this.assertActive();
        if (options?.fresh) {
            const fileNames = this.getVaultFileNames();
            this.index.replaceAll(fileNames);
            return await Promise.resolve(fileNames);
        }
        return await Promise.resolve(this.index.getFileNames());
    }

    async findPathIdentityCandidates(
        path: FilePath,
        policy: PathComparisonSettings
    ): Promise<readonly FilePath[]> {
        this.assertActive();
        return await Promise.resolve(this.index.findPathIdentityCandidates(path, policy));
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const eventRef of this.eventRefs.splice(0)) {
            this.vault.offref(eventRef);
        }
    }

    private readonly onCreate = (file: TAbstractFile): void => {
        if (this.disposed) {
            return;
        }
        if (isFolder(file)) {
            const prefix = `${file.path}/`;
            const added = this.getVaultFileNames().filter((path) => path.startsWith(prefix));
            this.index.apply({ removed: [], added });
            return;
        }
        this.index.apply({ removed: [], added: [file.path as FilePath] });
    };

    private readonly onDelete = (file: TAbstractFile): void => {
        if (this.disposed) {
            return;
        }
        if (isFolder(file)) {
            const removed = this.index.getFileNames().filter((path) => isInsideFolder(path, file.path));
            this.index.apply({ removed, added: [] });
            return;
        }
        this.index.apply({ removed: [file.path as FilePath], added: [] });
    };

    private readonly onRename = (file: TAbstractFile, oldPath: string): void => {
        if (this.disposed) {
            return;
        }
        if (isFolder(file)) {
            const oldPrefix = `${oldPath}/`;
            const newPrefix = `${file.path}/`;
            const removed = this.index.getFileNames().filter((path) => path.startsWith(oldPrefix));
            const added = removed.map((path) => `${newPrefix}${path.slice(oldPrefix.length)}` as FilePath);
            this.index.apply({ removed, added });
            return;
        }
        this.index.apply({ removed: [oldPath as FilePath], added: [file.path as FilePath] });
    };

    private getVaultFileNames(): FilePath[] {
        return this.vault.getFiles().map((file) => file.path as FilePath);
    }

    private assertActive(): void {
        if (this.disposed) {
            throw new Error("Obsidian file-name source has been disposed");
        }
    }
}
