/**
 * Validate the platform-neutral path vocabulary used by rooted storage adapters.
 *
 * Paths are slash-separated and relative to the root bound to the adapter. Root
 * selection and authorisation happen before the adapter is constructed.
 */
export function validateStoragePath(storagePath: string, allowRoot: boolean = true): string {
    if (storagePath === "") {
        if (allowRoot) return storagePath;
        throw new Error("The storage root is not a valid entry path");
    }

    if (storagePath.startsWith("/") || storagePath.startsWith("\\") || /^[A-Za-z]:/.test(storagePath)) {
        throw new Error(`Storage paths must be relative to the configured root: ${storagePath}`);
    }
    if (storagePath.includes("\\")) {
        throw new Error(`Storage paths must use forward slashes: ${storagePath}`);
    }

    const segments = storagePath.split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) {
        throw new Error(`Storage paths must not contain traversal segments: ${storagePath}`);
    }

    return storagePath;
}
