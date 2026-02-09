import { compareMTime, EVEN } from "@/common/utils";
import { TFile, type DataWriteOptions } from "@/deps";
import type { FilePath } from "@/lib/src/common/types";
import { isDocContentSame, readContent } from "@/lib/src/common/utils";
import { waitForIdle, type LiveSyncHarness } from "../harness/harness";
import { expect } from "vitest";

export const defaultFileOption = {
    mtime: new Date(2026, 0, 1, 0, 1, 2, 3).getTime(),
} as const satisfies DataWriteOptions;
export async function storeFile(
    harness: LiveSyncHarness,
    path: string,
    content: string | Blob,
    deleteBeforeSend = false,
    fileOptions = defaultFileOption
) {
    if (deleteBeforeSend && harness.app.vault.getAbstractFileByPath(path)) {
        console.log(`Deleting existing file ${path}`);
        await harness.app.vault.delete(harness.app.vault.getAbstractFileByPath(path) as TFile);
    }
    // Create file via vault
    if (content instanceof Blob) {
        console.log(`Creating binary file ${path}`);
        await harness.app.vault.createBinary(path, await content.arrayBuffer(), fileOptions);
    } else {
        await harness.app.vault.create(path, content, fileOptions);
    }

    // Ensure file is created
    const file = harness.app.vault.getAbstractFileByPath(path);
    expect(file).toBeInstanceOf(TFile);
    if (file instanceof TFile) {
        expect(compareMTime(file.stat.mtime, fileOptions?.mtime ?? defaultFileOption.mtime)).toBe(EVEN);
        if (content instanceof Blob) {
            const readContent = await harness.app.vault.readBinary(file);
            expect(await isDocContentSame(readContent, content)).toBe(true);
        } else {
            const readContent = await harness.app.vault.read(file);
            expect(readContent).toBe(content);
        }
    }
    await harness.plugin.services.fileProcessing.commitPendingFileEvents();
    await waitForIdle(harness);
    return file;
}
export async function readFromLocalDB(harness: LiveSyncHarness, path: string) {
    const entry = await harness.plugin.localDatabase.getDBEntry(path as FilePath);
    expect(entry).not.toBe(false);
    return entry;
}
export async function readFromVault(
    harness: LiveSyncHarness,
    path: string,
    isBinary: boolean = false,
    fileOptions = defaultFileOption
): Promise<string | ArrayBuffer> {
    const file = harness.app.vault.getAbstractFileByPath(path);
    expect(file).toBeInstanceOf(TFile);
    if (file instanceof TFile) {
        // console.log(`MTime: ${file.stat.mtime}, Expected: ${fileOptions.mtime}`);
        if (fileOptions.mtime !== undefined) {
            expect(compareMTime(file.stat.mtime, fileOptions.mtime)).toBe(EVEN);
        }
        const content = isBinary ? await harness.app.vault.readBinary(file) : await harness.app.vault.read(file);
        return content;
    }

    throw new Error("File not found in vault");
}
export async function checkStoredFileInDB(
    harness: LiveSyncHarness,
    path: string,
    content: string | Blob,
    fileOptions = defaultFileOption
) {
    const entry = await readFromLocalDB(harness, path);
    if (entry === false) {
        throw new Error("DB Content not found");
    }
    const contentToCheck = content instanceof Blob ? await content.arrayBuffer() : content;
    const isDocSame = await isDocContentSame(readContent(entry), contentToCheck);
    if (fileOptions.mtime !== undefined) {
        expect(compareMTime(entry.mtime, fileOptions.mtime)).toBe(EVEN);
    }
    expect(isDocSame).toBe(true);
    return Promise.resolve();
}
export async function testFileWrite(
    harness: LiveSyncHarness,
    path: string,
    content: string | Blob,
    skipCheckToBeWritten = false,
    fileOptions = defaultFileOption
) {
    const file = await storeFile(harness, path, content, false, fileOptions);
    expect(file).toBeInstanceOf(TFile);
    await harness.plugin.services.fileProcessing.commitPendingFileEvents();
    await waitForIdle(harness);
    const vaultFile = await readFromVault(harness, path, content instanceof Blob, fileOptions);
    expect(await isDocContentSame(vaultFile, content)).toBe(true);
    await harness.plugin.services.fileProcessing.commitPendingFileEvents();
    await waitForIdle(harness);
    if (skipCheckToBeWritten) {
        return Promise.resolve();
    }
    await checkStoredFileInDB(harness, path, content);
    return Promise.resolve();
}
export async function testFileRead(
    harness: LiveSyncHarness,
    path: string,
    expectedContent: string | Blob,
    fileOptions = defaultFileOption
) {
    await waitForIdle(harness);
    const file = await readFromVault(harness, path, expectedContent instanceof Blob, fileOptions);
    const isDocSame = await isDocContentSame(file, expectedContent);
    expect(isDocSame).toBe(true);
    // Check local database entry
    const entry = await readFromLocalDB(harness, path);
    expect(entry).not.toBe(false);
    if (entry === false) {
        throw new Error("DB Content not found");
    }
    const isDBDocSame = await isDocContentSame(readContent(entry), expectedContent);
    expect(isDBDocSame).toBe(true);
    return await Promise.resolve();
}
