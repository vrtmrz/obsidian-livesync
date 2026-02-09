import { beforeAll, describe, expect, it, test } from "vitest";
import { generateHarness, waitForIdle, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { TFile } from "@/deps.ts";
import { DEFAULT_SETTINGS, type FilePath, type ObsidianLiveSyncSettings } from "@/lib/src/common/types";
import { isDocContentSame, readContent } from "@/lib/src/common/utils";
import { DummyFileSourceInisialised, generateBinaryFile, generateFile, init } from "../utils/dummyfile";

const localdb_test_setting = {
    ...DEFAULT_SETTINGS,
    isConfigured: true,
    handleFilenameCaseSensitive: false,
} as ObsidianLiveSyncSettings;

describe.skip("Plugin Integration Test (Local Database)", async () => {
    let harness: LiveSyncHarness;
    const vaultName = "TestVault" + Date.now();

    beforeAll(async () => {
        await DummyFileSourceInisialised;
        harness = await generateHarness(vaultName, localdb_test_setting);
        await waitForReady(harness);
    });

    it("should be instantiated and defined", async () => {
        expect(harness.plugin).toBeDefined();
        expect(harness.plugin.app).toBe(harness.app);
        return await Promise.resolve();
    });

    it("should have services initialized", async () => {
        expect(harness.plugin.services).toBeDefined();
        return await Promise.resolve();
    });
    it("should have local database initialized", async () => {
        expect(harness.plugin.localDatabase).toBeDefined();
        expect(harness.plugin.localDatabase.isReady).toBe(true);
        return await Promise.resolve();
    });

    it("should store the changes into the local database", async () => {
        const path = "test-store6.md";
        const content = "Hello, World!";
        if (harness.app.vault.getAbstractFileByPath(path)) {
            console.log(`Deleting existing file ${path}`);
            await harness.app.vault.delete(harness.app.vault.getAbstractFileByPath(path) as TFile);
        }
        // Create file via vault
        await harness.app.vault.create(path, content);

        const file = harness.app.vault.getAbstractFileByPath(path);
        expect(file).toBeInstanceOf(TFile);

        if (file instanceof TFile) {
            const readContent = await harness.app.vault.read(file);
            expect(readContent).toBe(content);
        }
        await harness.plugin.services.fileProcessing.commitPendingFileEvents();
        await waitForIdle(harness);
        // await delay(100); // Wait a bit for the local database to process

        const entry = await harness.plugin.localDatabase.getDBEntry(path as FilePath);
        expect(entry).not.toBe(false);
        if (entry) {
            expect(readContent(entry)).toBe(content);
        }
        return await Promise.resolve();
    });
    test.each([10, 100, 1000, 10000, 50000, 100000])("should handle large file of size %i bytes", async (size) => {
        const path = `test-large-file-${size}.md`;
        const content = Array.from(generateFile(size)).join("");
        if (harness.app.vault.getAbstractFileByPath(path)) {
            console.log(`Deleting existing file ${path}`);
            await harness.app.vault.delete(harness.app.vault.getAbstractFileByPath(path) as TFile);
        }
        // Create file via vault
        await harness.app.vault.create(path, content);
        const file = harness.app.vault.getAbstractFileByPath(path);
        expect(file).toBeInstanceOf(TFile);
        if (file instanceof TFile) {
            const readContent = await harness.app.vault.read(file);
            expect(readContent).toBe(content);
        }
        await harness.plugin.services.fileProcessing.commitPendingFileEvents();
        await waitForIdle(harness);

        const entry = await harness.plugin.localDatabase.getDBEntry(path as FilePath);
        expect(entry).not.toBe(false);
        if (entry) {
            expect(readContent(entry)).toBe(content);
        }
        return await Promise.resolve();
    });

    const binaryMap = Array.from({ length: 7 }, (_, i) => Math.pow(2, i * 4));
    test.each(binaryMap)("should handle binary file of size %i bytes", async (size) => {
        const path = `test-binary-file-${size}.bin`;
        const content = new Blob([...generateBinaryFile(size)], { type: "application/octet-stream" });
        if (harness.app.vault.getAbstractFileByPath(path)) {
            console.log(`Deleting existing file ${path}`);
            await harness.app.vault.delete(harness.app.vault.getAbstractFileByPath(path) as TFile);
        }
        // Create file via vault
        await harness.app.vault.createBinary(path, await content.arrayBuffer());
        const file = harness.app.vault.getAbstractFileByPath(path);
        expect(file).toBeInstanceOf(TFile);
        if (file instanceof TFile) {
            const readContent = await harness.app.vault.readBinary(file);
            expect(await isDocContentSame(readContent, content)).toBe(true);
        }

        await harness.plugin.services.fileProcessing.commitPendingFileEvents();
        await waitForIdle(harness);
        const entry = await harness.plugin.localDatabase.getDBEntry(path as FilePath);
        expect(entry).not.toBe(false);
        if (entry) {
            const entryContent = await readContent(entry);
            if (!(entryContent instanceof ArrayBuffer)) {
                throw new Error("Entry content is not an ArrayBuffer");
            }
            // const expectedContent = await content.arrayBuffer();
            expect(await isDocContentSame(entryContent, content)).toBe(true);
        }
        return await Promise.resolve();
    });
});
