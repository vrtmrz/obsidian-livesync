import { fs, path } from "@vrtmrz/livesync-commonlib/node";

export function isStorageCaseInsensitive(vaultPath: string): boolean {
    // Probe with an empty directory on the Vault filesystem. The dot-prefixed name is
    // excluded by the CLI watcher and synchronisation filters; finally removes it after detection.
    const probePath = fs.mkdtempSync(path.join(vaultPath, ".livesync-case-"));
    try {
        const original = fs.statSync(probePath);
        const alternate = fs.statSync(path.join(vaultPath, path.basename(probePath).toUpperCase()), {
            throwIfNoEntry: false,
        });
        return alternate !== undefined && original.dev === alternate.dev && original.ino === alternate.ino;
    } finally {
        fs.rmdirSync(probePath);
    }
}
