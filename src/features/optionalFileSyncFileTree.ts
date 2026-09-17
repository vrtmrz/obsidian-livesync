export type OptionalFileSyncDirectoryListing = {
    files: readonly string[];
    folders: readonly string[];
};

export type OptionalFileSyncFileTreeDependencies = {
    listFiles(path: string): Promise<OptionalFileSyncDirectoryListing>;
};

export type OptionalFileSyncFileTreeOptions = {
    maxDepth?: number;
    shouldInclude?(path: string): boolean | Promise<boolean>;
    onError?(path: string, error: unknown): void;
};

export async function collectOptionalFileSyncFiles(
    dependencies: OptionalFileSyncFileTreeDependencies,
    path: string,
    options: OptionalFileSyncFileTreeOptions = {}
): Promise<string[]> {
    if (options.maxDepth !== undefined && options.maxDepth < 0) {
        return [];
    }

    let listing: OptionalFileSyncDirectoryListing;
    try {
        listing = await dependencies.listFiles(path);
    } catch (error) {
        options.onError?.(path, error);
        return [];
    }

    const files: string[] = [];
    for (const file of listing.files) {
        if ((await options.shouldInclude?.(file)) ?? true) {
            files.push(file);
        }
    }
    for (const folder of listing.folders) {
        if (!((await options.shouldInclude?.(folder)) ?? true)) {
            continue;
        }
        files.push(
            ...(await collectOptionalFileSyncFiles(dependencies, folder, {
                ...options,
                maxDepth: options.maxDepth === undefined ? undefined : options.maxDepth - 1,
            }))
        );
    }
    return files;
}
