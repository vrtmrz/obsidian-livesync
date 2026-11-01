import { fs } from "@vrtmrz/livesync-commonlib/node";

/** Read a string-valued version field from a JSON file during Node builds. */
export function readVersion(filePath: string): string | undefined {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
        return undefined;
    }
    return typeof parsed.version === "string" ? parsed.version : undefined;
}
