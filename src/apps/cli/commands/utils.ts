import { path } from "@vrtmrz/livesync-commonlib/node";

export function toArrayBuffer(data: Buffer): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function toDatabaseRelativePath(inputPath: string, databasePath: string): string {
    const stripped = inputPath.replace(/^[/\\]+/, "");
    if (!path.isAbsolute(inputPath)) {
        const normalized = stripped.replace(/\\/g, "/");
        const resolved = path.resolve(databasePath, normalized);
        const rel = path.relative(databasePath, resolved);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(`Path ${inputPath} is outside of the local database directory`);
        }
        return rel.replace(/\\/g, "/");
    }
    const resolved = path.resolve(inputPath);
    const rel = path.relative(databasePath, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Path ${inputPath} is outside of the local database directory`);
    }
    return rel.replace(/\\/g, "/");
}
