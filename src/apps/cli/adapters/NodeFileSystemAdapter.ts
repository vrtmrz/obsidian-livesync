import type { FilePath, UXStat } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IFileSystemAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters";
import { NodePathAdapter } from "./NodePathAdapter";
import { NodeTypeGuardAdapter } from "./NodeTypeGuardAdapter";
import { NodeConversionAdapter } from "./NodeConversionAdapter";
import { NodeStorageAdapter, fsPromises, path, validateStoragePath } from "@vrtmrz/livesync-commonlib/node";
import { NodeVaultAdapter } from "./NodeVaultAdapter";
import type { NodeFile, NodeFolder, NodeStat } from "./NodeTypes";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";

/**
 * Complete file system adapter implementation for Node.js
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter<NodeFile, NodeFile, NodeFolder, NodeStat> {
    readonly path: NodePathAdapter;
    readonly typeGuard: NodeTypeGuardAdapter;
    readonly conversion: NodeConversionAdapter;
    readonly storage: NodeStorageAdapter;
    readonly vault: NodeVaultAdapter;

    private fileCache = new Map<string, NodeFile>();
    private fileCacheVersion = 0;
    private completeScan: Promise<NodeFile[]> | undefined;
    private reportedScanErrors = new WeakSet<object>();

    constructor(
        private basePath: string,
        private reportDiagnostic: CliDiagnosticReporter = () => undefined
    ) {
        this.path = new NodePathAdapter();
        this.typeGuard = new NodeTypeGuardAdapter();
        this.conversion = new NodeConversionAdapter();
        this.storage = new NodeStorageAdapter(basePath);
        this.vault = new NodeVaultAdapter(this.storage);
    }

    private resolvePath(p: FilePath | string): string {
        return path.join(this.basePath, validateStoragePath(String(p), true));
    }

    private normalisePath(p: FilePath | string): string {
        return this.path.normalisePath(p);
    }

    private cacheFile(pathStr: string, file: NodeFile): void {
        this.fileCache.set(pathStr, file);
        this.fileCacheVersion++;
    }

    private evictFile(pathStr: string): void {
        if (this.fileCache.delete(pathStr)) this.fileCacheVersion++;
    }

    private async hasExactPathCase(pathStr: string): Promise<boolean> {
        try {
            const segments = pathStr.split("/").filter((segment) => segment !== "");
            let currentPath = "";
            for (const segment of segments) {
                const entries = await this.storage.list(currentPath);
                const candidatePath = currentPath === "" ? segment : `${currentPath}/${segment}`;
                if (!entries.files.includes(candidatePath) && !entries.folders.includes(candidatePath)) return false;
                currentPath = candidatePath;
            }
            return segments.length > 0;
        } catch {
            return false;
        }
    }

    async getAbstractFileByPath(p: FilePath | string): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);
        if (!this.fileCache.has(pathStr) && !(await this.hasExactPathCase(pathStr))) {
            this.evictFile(pathStr);
            return null;
        }
        return await this.refreshFile(pathStr);
    }

    async getAbstractFileByPathInsensitive(p: FilePath | string): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);

        const exact = await this.getAbstractFileByPath(pathStr);
        if (exact) {
            return exact;
        }

        const lowerPath = pathStr.toLowerCase();
        for (const [cachedPath, cachedFile] of this.fileCache.entries()) {
            if (cachedPath.toLowerCase() === lowerPath) {
                return cachedFile;
            }
        }

        await this.getFiles();

        for (const [cachedPath, cachedFile] of this.fileCache.entries()) {
            if (cachedPath.toLowerCase() === lowerPath) {
                return cachedFile;
            }
        }

        return null;
    }

    async getFiles(): Promise<NodeFile[]> {
        // Share one complete scan across concurrent callers. The cache is
        // replaced only after a successful traversal, so an I/O failure cannot
        // turn a partial inventory into database deletions.
        if (!this.completeScan) {
            const scan = this.buildCompleteInventory();
            this.completeScan = scan;
            void scan.then(
                () => {
                    if (this.completeScan === scan) this.completeScan = undefined;
                },
                () => {
                    if (this.completeScan === scan) this.completeScan = undefined;
                }
            );
        }
        return Array.from(await this.completeScan);
    }

    private async buildCompleteInventory(): Promise<NodeFile[]> {
        // A targeted reflection can mutate the cache while the scan is running.
        // Retry until one traversal observes a stable cache generation; fail
        // closed rather than publishing an uncertain inventory.
        for (let attempt = 0; attempt < 3; attempt++) {
            const versionAtStart = this.fileCacheVersion;
            const inventory = new Map<string, NodeFile>();
            await this.scanDirectoryInto("", inventory);
            if (this.fileCacheVersion !== versionAtStart) continue;

            this.fileCache = inventory;
            this.fileCacheVersion++;
            return Array.from(inventory.values());
        }
        throw new Error("Vault changed repeatedly during the complete filesystem scan");
    }

    async renameFile(file: NodeFile, newPath: string): Promise<NodeFile> {
        const oldPath = file.path;
        await this.vault.rename(file, newPath);
        this.evictFile(oldPath);
        const renamedFile = await this.refreshFile(newPath);
        if (!renamedFile) throw new Error(`Could not find renamed file: ${newPath}`);
        return renamedFile;
    }

    async statFromNative(file: NodeFile): Promise<UXStat> {
        return file.stat;
    }

    async reconcileInternalFile(p: string): Promise<void> {
        // No-op in Node.js version
        // This is used by Obsidian to sync internal file metadata
    }

    async refreshFile(p: string): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);
        try {
            const stat = await this.storage.stat(pathStr);
            if (stat?.type !== "file") {
                this.evictFile(pathStr);
                return null;
            }

            const file: NodeFile = {
                path: pathStr as FilePath,
                stat: {
                    size: stat.size,
                    mtime: stat.mtime,
                    ctime: stat.ctime,
                    type: "file",
                },
            };
            this.cacheFile(pathStr, file);
            return file;
        } catch {
            // Evict so a deleted file is not returned by subsequent cache scans.
            this.evictFile(pathStr);
            return null;
        }
    }

    protected async readDirectory(relativePath: string): Promise<{ files: string[]; folders: string[] }> {
        const entries = await fsPromises.readdir(this.resolvePath(relativePath), { withFileTypes: true });
        const files: string[] = [];
        const folders: string[] = [];
        for (const entry of entries) {
            const entryPath = path.join(relativePath, entry.name).replace(/\\/g, "/");
            // Match NodeStorageAdapter's safety boundary: symbolic links are not
            // part of the vault inventory and are never traversed.
            if (entry.isFile()) files.push(entryPath);
            else if (entry.isDirectory()) folders.push(entryPath);
        }
        return { files, folders };
    }

    /**
     * Explicit rescans remain public for CLI callers, but use the same atomic,
     * fail-closed inventory path as getFiles().
     */
    async scanDirectory(relativePath: string = ""): Promise<void> {
        if (relativePath === "") {
            await this.getFiles();
            return;
        }
        const versionAtStart = this.fileCacheVersion;
        const inventory = new Map(this.fileCache);
        await this.scanDirectoryInto(relativePath, inventory);
        if (this.fileCacheVersion !== versionAtStart) {
            throw new Error("Vault changed during the filesystem scan");
        }
        this.fileCache = inventory;
        this.fileCacheVersion++;
    }

    private async scanDirectoryInto(relativePath: string, inventory: Map<string, NodeFile>): Promise<void> {
        const fullPath = this.resolvePath(relativePath);
        try {
            let directoryStat;
            try {
                // Preserve NodeStorageAdapter's nested-symbolic-link guard;
                // native fs calls below are used only so ordinary I/O failures
                // propagate instead of being converted to an empty listing.
                await this.storage.stat(relativePath);
                directoryStat = await fsPromises.stat(fullPath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    throw new Error(`Directory does not exist: ${fullPath}`);
                }
                throw error;
            }
            if (!directoryStat.isDirectory()) throw new Error(`Directory does not exist: ${fullPath}`);
            const entries = await this.readDirectory(relativePath);

            for (const entryPath of entries.files) {
                const stat = await fsPromises.stat(this.resolvePath(entryPath));
                if (!stat.isFile()) continue;
                inventory.set(entryPath, {
                    path: entryPath as FilePath,
                    stat: {
                        size: stat.size,
                        mtime: Math.floor(stat.mtimeMs),
                        ctime: Math.floor(stat.ctimeMs),
                        type: "file",
                    },
                });
            }
            for (const entryPath of entries.folders) {
                await this.scanDirectoryInto(entryPath, inventory);
            }
        } catch (error) {
            if (typeof error !== "object" || error === null || !this.reportedScanErrors.has(error)) {
                this.reportDiagnostic(`Error scanning directory ${fullPath}:`, error);
                if (typeof error === "object" && error !== null) this.reportedScanErrors.add(error);
            }
            throw error;
        }
    }
}
