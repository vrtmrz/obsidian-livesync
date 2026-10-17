import { path } from "@vrtmrz/livesync-commonlib/node";
import type { CLICommand } from "./types";

export function getForceRequirementError(command: CLICommand, force = false): string | undefined {
    if (force) return undefined;
    if (command === "rebuild") {
        return "Command 'rebuild' requires --force because it replaces the local and remote databases.";
    }
    if (command === "fetch") {
        return "Command 'fetch' requires --force because it replaces the local database with remote state.";
    }
    return undefined;
}

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
