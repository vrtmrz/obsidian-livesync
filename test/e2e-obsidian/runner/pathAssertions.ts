import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { hasExactCaseOnlyRename } from "./pathEntries.ts";

export async function waitForExactCaseOnlyRename(
    vaultPath: string,
    oldPath: string,
    newPath: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000)
): Promise<void> {
    const oldDirectory = dirname(oldPath);
    const newDirectory = dirname(newPath);
    if (oldDirectory !== newDirectory) {
        throw new Error(`Case-only rename paths must share one parent directory: ${oldPath} -> ${newPath}`);
    }

    const oldName = basename(oldPath);
    const newName = basename(newPath);
    const directoryPath = join(vaultPath, newDirectory);
    const deadline = Date.now() + timeoutMs;
    let lastEntries: string[] = [];
    while (Date.now() < deadline) {
        lastEntries = await readdir(directoryPath);
        if (hasExactCaseOnlyRename(lastEntries, oldName, newName)) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
        `Timed out waiting for exact case-only rename: ${oldPath} -> ${newPath}. Directory entries: ${JSON.stringify(lastEntries)}`
    );
}
