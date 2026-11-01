export async function findCaseInsensitiveFile<T extends object>(
    requestedPath: string,
    findExact: () => Promise<T | null>,
    cachedFiles: ReadonlyMap<string, T>,
    scan: () => Promise<void>
): Promise<T | null> {
    const exact = await findExact();
    if (exact) return exact;

    const lowerPath = requestedPath.toLowerCase();
    const findCached = (): T | null => {
        for (const [cachedPath, cachedFile] of cachedFiles) {
            if (cachedPath.toLowerCase() === lowerPath) return cachedFile;
        }
        return null;
    };

    const cached = findCached();
    if (cached) return cached;

    await scan();
    return findCached();
}
