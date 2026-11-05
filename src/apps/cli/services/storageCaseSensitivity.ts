import { fs, path } from "@vrtmrz/livesync-commonlib/node";

export function isStorageCaseInsensitive(vaultPath: string): boolean {
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
