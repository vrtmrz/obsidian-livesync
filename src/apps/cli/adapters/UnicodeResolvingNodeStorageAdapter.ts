import { NodeStorageAdapter, validateStoragePath } from "@vrtmrz/livesync-commonlib/node";

export class AmbiguousNormalisedPathError extends Error {
    constructor(path: string) {
        super(`Ambiguous path after Unicode normalisation: ${path}`);
        this.name = "AmbiguousNormalisedPathError";
    }
}

/** Resolves NFC-equivalent logical paths against current Node storage listings. */
export class UnicodeResolvingNodeStorageAdapter extends NodeStorageAdapter {
    constructor(
        rootPath: string,
        private readonly getPathNormalizationVersion: () => number = () => 0,
        private readonly isCaseInsensitive: () => boolean = () => false
    ) {
        super(rootPath);
    }

    get isUnicodePathNormalizationEnabled(): boolean {
        return this.getPathNormalizationVersion() === 1;
    }

    /** Read metadata for an entry already resolved or obtained from a storage listing. */
    async statExact(path: string) {
        return await super.trystat(path);
    }

    /** Inspect a physical directory once before descending into its enumerated entries. */
    async listExact(path: string) {
        const entries = await super.list(path);
        if (this.isUnicodePathNormalizationEnabled) {
            const caseInsensitive = this.isCaseInsensitive();
            const names = new Map<string, string>();
            for (const entry of [...entries.files, ...entries.folders]) {
                const key = this.comparisonKey(entry, caseInsensitive);
                if (names.has(key)) throw new AmbiguousNormalisedPathError(entry);
                names.set(key, entry);
            }
        }
        return entries;
    }

    async resolveLogicalPath(
        path: string,
        caseInsensitive = this.isCaseInsensitive(),
        allowMissing = true
    ): Promise<string | null> {
        if (!this.isUnicodePathNormalizationEnabled) return path;

        validateStoragePath(path, true);
        if (path === "") return "";

        const segments = path.split("/");
        let resolvedParent = "";

        for (let index = 0; index < segments.length; index++) {
            const segment = segments[index];
            const entries = await super.list(resolvedParent);
            const candidates = [...entries.files, ...entries.folders];
            const requestedKey = this.comparisonKey(segment, caseInsensitive);
            const matches = candidates.filter((entryPath) => {
                const entryName = entryPath.slice(resolvedParent === "" ? 0 : resolvedParent.length + 1);
                return this.comparisonKey(entryName, caseInsensitive) === requestedKey;
            });

            if (matches.length > 1) throw new AmbiguousNormalisedPathError(path);
            if (matches.length === 1) {
                resolvedParent = matches[0];
                continue;
            }

            if (!allowMissing) return null;
            const remainingPath = segments.slice(index).join("/");
            return resolvedParent === "" ? remainingPath : `${resolvedParent}/${remainingPath}`;
        }

        return resolvedParent;
    }

    override async exists(path: string, caseInsensitive = this.isCaseInsensitive()): Promise<boolean> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, false);
        if (resolvedPath === null) return false;
        return await super.exists(resolvedPath);
    }

    override async trystat(path: string, caseInsensitive = this.isCaseInsensitive()) {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, false);
        if (resolvedPath === null) return null;
        return await super.trystat(resolvedPath);
    }

    override async stat(path: string, caseInsensitive = this.isCaseInsensitive()) {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, false);
        if (resolvedPath === null) return null;
        return await super.trystat(resolvedPath);
    }

    override async mkdir(path: string, caseInsensitive = this.isCaseInsensitive()): Promise<void> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, true);
        if (resolvedPath === null) throw new Error(`Could not resolve path: ${path}`);
        await super.mkdir(resolvedPath);
    }

    override async remove(path: string, caseInsensitive = this.isCaseInsensitive()): Promise<void> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, false);
        await super.remove(resolvedPath ?? path);
    }

    override async read(path: string, caseInsensitive = this.isCaseInsensitive()): Promise<string> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, false);
        return await super.read(resolvedPath ?? path);
    }

    override async readBinary(path: string, caseInsensitive = this.isCaseInsensitive()): Promise<ArrayBuffer> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, false);
        return await super.readBinary(resolvedPath ?? path);
    }

    override async write(
        path: string,
        data: string,
        options?: Parameters<NodeStorageAdapter["write"]>[2],
        caseInsensitive = this.isCaseInsensitive()
    ): Promise<void> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, true);
        if (resolvedPath === null) throw new Error(`Could not resolve path: ${path}`);
        await super.write(resolvedPath, data, options);
    }

    override async writeBinary(
        path: string,
        data: ArrayBuffer,
        options?: Parameters<NodeStorageAdapter["writeBinary"]>[2],
        caseInsensitive = this.isCaseInsensitive()
    ): Promise<void> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, true);
        if (resolvedPath === null) throw new Error(`Could not resolve path: ${path}`);
        await super.writeBinary(resolvedPath, data, options);
    }

    override async append(
        path: string,
        data: string,
        options?: Parameters<NodeStorageAdapter["append"]>[2],
        caseInsensitive = this.isCaseInsensitive()
    ): Promise<void> {
        const resolvedPath = await this.resolveLogicalPath(path, caseInsensitive, true);
        if (resolvedPath === null) throw new Error(`Could not resolve path: ${path}`);
        await super.append(resolvedPath, data, options);
    }

    override async rename(
        sourcePath: string,
        targetPath: string,
        caseInsensitive = this.isCaseInsensitive()
    ): Promise<void> {
        const resolvedSource = await this.resolveLogicalPath(sourcePath, caseInsensitive, false);
        if (resolvedSource === null) return await super.rename(sourcePath, targetPath);

        const resolvedTarget = await this.resolveLogicalPath(targetPath, caseInsensitive, true);
        if (resolvedTarget === null) throw new Error(`Could not resolve path: ${targetPath}`);

        // Preserve explicit case-only or Unicode-spelling renames when the target resolves to the source.
        const sourceKey = this.comparisonKey(resolvedSource, caseInsensitive);
        const targetKey = this.comparisonKey(resolvedTarget, caseInsensitive);
        const target =
            sourceKey === targetKey && resolvedTarget === resolvedSource && targetPath !== resolvedSource
                ? await this.resolveRenameTargetSpelling(targetPath, caseInsensitive)
                : resolvedTarget;

        await super.rename(resolvedSource, target);
    }

    override async list(basePath: string, caseInsensitive = this.isCaseInsensitive()) {
        const resolvedPath = await this.resolveLogicalPath(basePath, caseInsensitive, false);
        if (resolvedPath === null) return { files: [], folders: [] };
        return await super.list(resolvedPath);
    }

    private async resolveRenameTargetSpelling(path: string, caseInsensitive: boolean): Promise<string> {
        validateStoragePath(path, false);
        const segments = path.split("/");
        const leaf = segments.pop();
        if (leaf === undefined) throw new Error(`Could not resolve path: ${path}`);
        const parentPath = segments.join("/");
        const resolvedParent = await this.resolveLogicalPath(parentPath, caseInsensitive, true);
        if (resolvedParent === null) throw new Error(`Could not resolve path: ${path}`);

        const entries = await super.list(resolvedParent);
        const requestedKey = this.comparisonKey(leaf, caseInsensitive);
        const matches = [...entries.files, ...entries.folders].filter((entryPath) => {
            const entryName = entryPath.slice(resolvedParent === "" ? 0 : resolvedParent.length + 1);
            return this.comparisonKey(entryName, caseInsensitive) === requestedKey;
        });
        if (matches.length > 1) throw new AmbiguousNormalisedPathError(path);

        return resolvedParent === "" ? leaf : `${resolvedParent}/${leaf}`;
    }

    private comparisonKey(segment: string, caseInsensitive: boolean): string {
        const normalisedSegment = segment.normalize("NFC");
        return caseInsensitive ? normalisedSegment.toLowerCase() : normalisedSegment;
    }
}
