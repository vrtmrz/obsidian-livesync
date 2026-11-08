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
import { findCaseInsensitiveFile } from "@/apps/caseInsensitiveFileLookup";
import { isHiddenPath } from "@/apps/cli/cliPathFilter";
import {
    createStoragePathResolver,
    parseFilePath,
    type StoragePath,
    type StoragePathResolver,
} from "@vrtmrz/livesync-commonlib/storage";

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
    private readonly isCaseInsensitiveSetting: () => boolean;

    constructor(
        private basePath: string,
        private reportDiagnostic: CliDiagnosticReporter = () => undefined,
        getPathNormalizationVersion: () => number = () => 0,
        isCaseInsensitive: () => boolean = () => false
    ) {
        this.path = new NodePathAdapter();
        this.typeGuard = new NodeTypeGuardAdapter();
        this.conversion = new NodeConversionAdapter();
        this.isCaseInsensitiveSetting = isCaseInsensitive;
        this.storage = new UnicodeResolvingNodeStorageAdapter(basePath, getPathNormalizationVersion, isCaseInsensitive);
        this.vault = new NodeVaultAdapter(this.storage);
    }

    private resolvePath(p: FilePath | string): string {
        return path.join(this.basePath, p);
    }

    private normalisePath(p: FilePath | string): FilePath {
        return parseFilePath(this.path.normalisePath(p));
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

        return await findCaseInsensitiveFile(
            pathStr,
            () => this.getAbstractFileByPath(pathStr),
            this.fileCache,
            () => this.scanDirectory()
        );
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
        if (this.storage.isUnicodePathNormalizationEnabled) {
            try {
                const resolvedPath = await this.storage.resolveLogicalPath(pathStr, caseInsensitive, false);
                if (resolvedPath === null) {
                    this.fileCache.delete(pathStr);
                    return null;
                }
                return await this.refreshResolvedFile(resolvedPath);
            } catch (error) {
                this.fileCache.delete(pathStr);
                throw error;
            }
        }
        try {
            const stat = await this.storage.stat(pathStr, caseInsensitive);
            if (stat?.type !== "file") {
                this.fileCache.delete(pathStr);
                return null;
            }
            const file: NodeFile = { path: pathStr, stat };
            this.fileCache.set(pathStr, file);
            return file;
        } catch (error) {
            if (error instanceof AmbiguousNormalisedPathError) throw error;
            this.fileCache.delete(pathStr);
            return null;
        }
    }

    private async refreshResolvedFile(resolvedPath: StoragePath): Promise<NodeFile | null> {
        try {
            const stat = await this.storage.statResolved(resolvedPath);
            if (stat?.type !== "file") {
                this.fileCache.delete(resolvedPath);
                return null;
            }

            const file: NodeFile = {
                path: resolvedPath,
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
            this.fileCache.delete(resolvedPath);
            throw error;
        }
    }

    /**
     * Helper method to recursively scan directory and populate file cache
     */
    async scanDirectory(relativePath: string = ""): Promise<void> {
        const files = new Map<string, NodeFile>();
        await this.scanDirectoryInto(relativePath, files);
        for (const [path, file] of files) this.fileCache.set(path, file);
    }

    private async scanDirectoryInto(relativePath: string, files: Map<string, NodeFile>): Promise<void> {
        if (isHiddenPath(relativePath)) return;
        const resolver = this.createScanResolver();
        const filePath = parseFilePath(relativePath);
        if (resolver) {
            const resolvedPath =
                filePath === "" ? await resolver.resolveForWrite(filePath) : await resolver.resolveExisting(filePath);
            if (resolvedPath !== null) await this.scanResolvedDirectoryInto(resolver, resolvedPath, files);
            return;
        }
        await this.scanLegacyDirectoryInto(filePath, files);
    }

    private createScanResolver(): StoragePathResolver | null {
        if (!this.storage.isUnicodePathNormalizationEnabled) return null;
        const caseInsensitive = this.isCaseInsensitiveSetting();
        return createStoragePathResolver({
            readDirectory: async (physicalDirectory) => await this.storage.readDirectory(physicalDirectory),
            policy: {
                pathNormalizationVersion: 1,
                handleFilenameCaseSensitive: !caseInsensitive,
            },
        });
    }

    private async scanResolvedDirectoryInto(
        resolver: StoragePathResolver,
        relativePath: StoragePath,
        files: Map<string, NodeFile>
    ): Promise<void> {
        const directoryStat = await this.storage.statResolved(relativePath);
        if (directoryStat === null) return;
        if (directoryStat.type !== "folder") {
            throw new Error(`Path is not a directory: ${this.resolvePath(relativePath)}`);
        }

        const entries = await resolver.listResolvedDirectory(relativePath);
        if (entries === null) return;
        for (const entry of entries) {
            if (entry.kind === "directory") {
                if (isHiddenPath(entry.path)) continue;
                await this.scanResolvedDirectoryInto(resolver, entry.path, files);
                continue;
            }

            const stat = await this.storage.statResolved(entry.path);
            if (stat?.type !== "file") continue;
            const file: NodeFile = { path: entry.path, stat };
            files.set(entry.path, file);
        }
    }

    private async scanLegacyDirectoryInto(relativePath: string, files: Map<string, NodeFile>): Promise<void> {
        const fullPath = this.resolvePath(relativePath);
        try {
            const directoryStat = await this.storage.stat(relativePath, false);
            if (directoryStat?.type !== "folder") throw new Error(`Directory does not exist: ${fullPath}`);
            const entries = await this.storage.list(relativePath, false);

            for (const entryPath of entries.files) {
                const stat = await this.storage.stat(entryPath, false);
                if (stat?.type !== "file") continue;
                const filePath = parseFilePath(entryPath);
                const file: NodeFile = {
                    path: filePath,
                    stat,
                };
                files.set(filePath, file);
            }
            for (const entryPath of entries.folders) {
                if (isHiddenPath(entryPath)) continue;
                await this.scanLegacyDirectoryInto(entryPath, files);
            }
        } catch (error) {
            if (error instanceof AmbiguousNormalisedPathError) throw error;
            this.reportDiagnostic(`Error scanning directory ${fullPath}:`, error);
        }
    }
}
