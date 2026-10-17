import type { FilePath, UXStat } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IFileSystemAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters";
import { NodePathAdapter } from "./NodePathAdapter";
import { NodeTypeGuardAdapter } from "./NodeTypeGuardAdapter";
import { NodeConversionAdapter } from "./NodeConversionAdapter";
import { AmbiguousNormalisedPathError, UnicodeResolvingNodeStorageAdapter } from "./UnicodeResolvingNodeStorageAdapter";
import { NodeVaultAdapter } from "./NodeVaultAdapter";
import type { NodeFile, NodeFolder, NodeStat } from "./NodeTypes";
import { path } from "@vrtmrz/livesync-commonlib/node";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";

/**
 * Complete file system adapter implementation for Node.js
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter<NodeFile, NodeFile, NodeFolder, NodeStat> {
    readonly path: NodePathAdapter;
    readonly typeGuard: NodeTypeGuardAdapter;
    readonly conversion: NodeConversionAdapter;
    readonly storage: UnicodeResolvingNodeStorageAdapter;
    readonly vault: NodeVaultAdapter;

    private fileCache = new Map<string, NodeFile>();

    constructor(
        private basePath: string,
        private reportDiagnostic: CliDiagnosticReporter = () => undefined,
        getPathNormalizationVersion: () => number = () => 0,
        isCaseInsensitive: () => boolean = () => false
    ) {
        this.path = new NodePathAdapter();
        this.typeGuard = new NodeTypeGuardAdapter();
        this.conversion = new NodeConversionAdapter();
        this.storage = new UnicodeResolvingNodeStorageAdapter(basePath, getPathNormalizationVersion, isCaseInsensitive);
        this.vault = new NodeVaultAdapter(this.storage);
    }

    private resolvePath(p: FilePath | string): string {
        return path.join(this.basePath, p);
    }

    private normalisePath(p: FilePath | string): string {
        return this.path.normalisePath(p);
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
        if (this.storage.isUnicodePathNormalizationEnabled) {
            const resolvedPath = await this.storage.resolveLogicalPath(pathStr, false, false);
            if (resolvedPath === null) {
                this.fileCache.delete(pathStr);
                return null;
            }
            return await this.refreshResolvedFile(resolvedPath);
        }
        if (!this.fileCache.has(pathStr) && !(await this.hasExactPathCase(pathStr))) {
            this.fileCache.delete(pathStr);
            return null;
        }
        return await this.refreshFile(pathStr);
    }

    async getAbstractFileByPathInsensitive(p: FilePath | string): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);

        if (this.storage.isUnicodePathNormalizationEnabled) {
            const resolvedPath = await this.storage.resolveLogicalPath(pathStr, true, false);
            if (resolvedPath === null) {
                this.fileCache.delete(pathStr);
                return null;
            }
            return await this.refreshResolvedFile(resolvedPath);
        }

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

        await this.scanDirectory();

        for (const [cachedPath, cachedFile] of this.fileCache.entries()) {
            if (cachedPath.toLowerCase() === lowerPath) {
                return cachedFile;
            }
        }

        return null;
    }

    async getFiles(): Promise<NodeFile[]> {
        const files = new Map<string, NodeFile>();
        await this.scanDirectoryInto("", files);
        return Array.from(files.values());
    }

    async renameFile(file: NodeFile, newPath: string): Promise<NodeFile> {
        const oldPath = file.path;
        await this.vault.rename(file, newPath);
        this.fileCache.delete(oldPath);
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

    async refreshFile(p: string, caseInsensitive = false): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);
        try {
            const resolvedPath = this.storage.isUnicodePathNormalizationEnabled
                ? await this.storage.resolveLogicalPath(pathStr, caseInsensitive, false)
                : pathStr;
            if (resolvedPath === null) {
                this.fileCache.delete(pathStr);
                return null;
            }
            return await this.refreshResolvedFile(resolvedPath);
        } catch (error) {
            if (error instanceof AmbiguousNormalisedPathError) throw error;
            this.fileCache.delete(pathStr);
            return null;
        }
    }

    private async refreshResolvedFile(resolvedPath: string): Promise<NodeFile | null> {
        try {
            const stat = await this.storage.statExact(resolvedPath);
            if (stat?.type !== "file") {
                this.fileCache.delete(resolvedPath);
                return null;
            }

            const file: NodeFile = {
                path: resolvedPath as FilePath,
                stat: {
                    size: stat.size,
                    mtime: stat.mtime,
                    ctime: stat.ctime,
                    type: "file",
                },
            };
            this.fileCache.set(resolvedPath, file);
            return file;
        } catch (error) {
            if (error instanceof AmbiguousNormalisedPathError) throw error;
            // Evict so a deleted file is not returned by subsequent cache scans.
            this.fileCache.delete(resolvedPath);
            return null;
        }
    }

    /**
     * Helper method to recursively scan directory and populate file cache
     */
    async scanDirectory(relativePath: string = ""): Promise<void> {
        const resolvedPath = await this.storage.resolveLogicalPath(relativePath, false, false);
        if (resolvedPath !== null) await this.scanDirectoryInto(resolvedPath, this.fileCache);
    }

    private async scanDirectoryInto(relativePath: string, files: Map<string, NodeFile>): Promise<void> {
        const fullPath = this.resolvePath(relativePath);
        try {
            const directoryStat = this.storage.isUnicodePathNormalizationEnabled
                ? await this.storage.statExact(relativePath)
                : await this.storage.stat(relativePath, false);
            if (directoryStat?.type !== "folder") throw new Error(`Directory does not exist: ${fullPath}`);
            const entries = await this.storage.listExact(relativePath);

            for (const entryPath of entries.files) {
                const stat = await this.storage.statExact(entryPath);
                if (stat?.type !== "file") continue;
                const file: NodeFile = {
                    path: entryPath as FilePath,
                    stat,
                };
                files.set(entryPath, file);
            }
            for (const entryPath of entries.folders) {
                await this.scanDirectoryInto(entryPath, files);
            }
        } catch (error) {
            if (error instanceof AmbiguousNormalisedPathError) throw error;
            // Directory doesn't exist or is not readable
            this.reportDiagnostic(`Error scanning directory ${fullPath}:`, error);
        }
    }
}
