// Functional Test on Main Cases
// This test suite only covers main functional cases of synchronisation. Event handling, error cases,
// and edge, resolving conflicts, etc. will be covered in separate test suites.
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { generateHarness, waitForIdle, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { RemoteTypes, type FilePath, type ObsidianLiveSyncSettings } from "@/lib/src/common/types";

import {
    DummyFileSourceInisialised,
    FILE_SIZE_BINS,
    FILE_SIZE_MD,
    generateBinaryFile,
    generateFile,
} from "../utils/dummyfile";
import { checkStoredFileInDB, testFileRead, testFileWrite } from "./db_common";
import { delay } from "@/lib/src/common/utils";
import { commands } from "vitest/browser";
import { closeReplication, performReplication, prepareRemote } from "./sync_common";
import type { DataWriteOptions } from "@/deps.ts";

type MTimedDataWriteOptions = DataWriteOptions & { mtime: number };
export type TestOptions = {
    setting: ObsidianLiveSyncSettings;
    fileOptions: MTimedDataWriteOptions;
};
function generateName(prefix: string, type: string, ext: string, size: number) {
    return `${prefix}-${type}-file-${size}.${ext}`;
}
export function syncBasicCase(label: string, { setting, fileOptions }: TestOptions) {
    describe("Replication Suite Tests - " + label, () => {
        const nameFile = (type: string, ext: string, size: number) => generateName("sync-test", type, ext, size);
        let serverPeerName = "";
        // TODO: Harness disposal may broke the event loop of P2P replication
        // so we keep the harnesses alive until all tests are done.
        // It may trystero's somethong, or not.
        let harnessUpload: LiveSyncHarness;
        let harnessDownload: LiveSyncHarness;
        beforeAll(async () => {
            await DummyFileSourceInisialised;
            if (setting.remoteType === RemoteTypes.REMOTE_P2P) {
                // await commands.closeWebPeer();
                serverPeerName = "t-" + Date.now();
                setting.P2P_AutoAcceptingPeers = serverPeerName;
                setting.P2P_AutoSyncPeers = serverPeerName;
                setting.P2P_DevicePeerName = "client-" + Date.now();
                await commands.openWebPeer(setting, serverPeerName);
            }
        });
        afterAll(async () => {
            if (setting.remoteType === RemoteTypes.REMOTE_P2P) {
                await commands.closeWebPeer();
                // await closeP2PReplicatorConnections(harnessUpload);
            }
        });

        describe("Remote Database Initialization", () => {
            let harnessInit: LiveSyncHarness;
            const sync_test_setting_init = {
                ...setting,
            } as ObsidianLiveSyncSettings;
            beforeAll(async () => {
                const vaultName = "TestVault" + Date.now();
                console.log(`BeforeAll - Remote Database Initialization - Vault: ${vaultName}`);
                harnessInit = await generateHarness(vaultName, sync_test_setting_init);
                await waitForReady(harnessInit);
                expect(harnessInit.plugin).toBeDefined();
                expect(harnessInit.plugin.app).toBe(harnessInit.app);
                await waitForIdle(harnessInit);
            });
            afterAll(async () => {
                await harnessInit.plugin.services.replicator.getActiveReplicator()?.closeReplication();
                await harnessInit.dispose();
                await delay(1000);
            });

            it("should reset remote database", async () => {
                // harnessInit = await generateHarness(vaultName, sync_test_setting_init);
                await waitForReady(harnessInit);
                await prepareRemote(harnessInit, sync_test_setting_init, true);
            });
            it("should be prepared for replication", async () => {
                await waitForReady(harnessInit);
                if (setting.remoteType !== RemoteTypes.REMOTE_P2P) {
                    const status = await harnessInit.plugin.services.replicator
                        .getActiveReplicator()
                        ?.getRemoteStatus(sync_test_setting_init);
                    console.log("Connected devices after reset:", status);
                    expect(status).not.toBeFalsy();
                }
            });
        });

        describe("Replication - Upload", () => {
            const sync_test_setting_upload = {
                ...setting,
            } as ObsidianLiveSyncSettings;

            beforeAll(async () => {
                const vaultName = "TestVault" + Date.now();
                console.log(`BeforeAll - Replication Upload - Vault: ${vaultName}`);
                if (setting.remoteType === RemoteTypes.REMOTE_P2P) {
                    sync_test_setting_upload.P2P_AutoAcceptingPeers = serverPeerName;
                    sync_test_setting_upload.P2P_AutoSyncPeers = serverPeerName;
                    sync_test_setting_upload.P2P_DevicePeerName = "up-" + Date.now();
                }
                harnessUpload = await generateHarness(vaultName, sync_test_setting_upload);
                await waitForReady(harnessUpload);
                expect(harnessUpload.plugin).toBeDefined();
                expect(harnessUpload.plugin.app).toBe(harnessUpload.app);
                await waitForIdle(harnessUpload);
            });

            afterAll(async () => {
                await closeReplication(harnessUpload);
            });

            it("should be instantiated and defined", () => {
                expect(harnessUpload.plugin).toBeDefined();
                expect(harnessUpload.plugin.app).toBe(harnessUpload.app);
            });

            it("should have services initialized", () => {
                expect(harnessUpload.plugin.services).toBeDefined();
            });

            it("should have local database initialized", () => {
                expect(harnessUpload.plugin.localDatabase).toBeDefined();
                expect(harnessUpload.plugin.localDatabase.isReady).toBe(true);
            });

            it("should prepare remote database", async () => {
                await prepareRemote(harnessUpload, sync_test_setting_upload, false);
            });

            // describe("File Creation", async () => {
            it("should a file has been created", async () => {
                const content = "Hello, World!";
                const path = nameFile("store", "md", 0);
                await testFileWrite(harnessUpload, path, content, false, fileOptions);
                // Perform replication
                // await harness.plugin.services.replication.replicate(true);
            });
            it("should different content of several files have been created correctly", async () => {
                await testFileWrite(harnessUpload, nameFile("test-diff-1", "md", 0), "Content A", false, fileOptions);
                await testFileWrite(harnessUpload, nameFile("test-diff-2", "md", 0), "Content B", false, fileOptions);
                await testFileWrite(harnessUpload, nameFile("test-diff-3", "md", 0), "Content C", false, fileOptions);
            });

            test.each(FILE_SIZE_MD)("should large file of size %i bytes has been created", async (size) => {
                const content = Array.from(generateFile(size)).join("");
                const path = nameFile("large", "md", size);
                const isTooLarge = harnessUpload.plugin.services.vault.isFileSizeTooLarge(size);
                if (isTooLarge) {
                    console.log(`Skipping file of size ${size} bytes as it is too large to sync.`);
                    expect(true).toBe(true);
                } else {
                    await testFileWrite(harnessUpload, path, content, false, fileOptions);
                }
            });

            test.each(FILE_SIZE_BINS)("should binary file of size %i bytes has been created", async (size) => {
                const content = new Blob([...generateBinaryFile(size)], { type: "application/octet-stream" });
                const path = nameFile("binary", "bin", size);
                await testFileWrite(harnessUpload, path, content, true, fileOptions);
                const isTooLarge = harnessUpload.plugin.services.vault.isFileSizeTooLarge(size);
                if (isTooLarge) {
                    console.log(`Skipping file of size ${size} bytes as it is too large to sync.`);
                    expect(true).toBe(true);
                } else {
                    await checkStoredFileInDB(harnessUpload, path, content, fileOptions);
                }
            });

            it("Replication after uploads", async () => {
                await performReplication(harnessUpload);
                await performReplication(harnessUpload);
            });
        });

        describe("Replication - Download", () => {
            // Download into a new vault
            const sync_test_setting_download = {
                ...setting,
            } as ObsidianLiveSyncSettings;
            beforeAll(async () => {
                const vaultName = "TestVault" + Date.now();
                console.log(`BeforeAll - Replication Download - Vault: ${vaultName}`);
                if (setting.remoteType === RemoteTypes.REMOTE_P2P) {
                    sync_test_setting_download.P2P_AutoAcceptingPeers = serverPeerName;
                    sync_test_setting_download.P2P_AutoSyncPeers = serverPeerName;
                    sync_test_setting_download.P2P_DevicePeerName = "down-" + Date.now();
                }
                harnessDownload = await generateHarness(vaultName, sync_test_setting_download);
                await waitForReady(harnessDownload);
                await prepareRemote(harnessDownload, sync_test_setting_download, false);

                await performReplication(harnessDownload);
                await waitForIdle(harnessDownload);
                await delay(1000);
                await performReplication(harnessDownload);
                await waitForIdle(harnessDownload);
            });
            afterAll(async () => {
                await closeReplication(harnessDownload);
            });

            it("should be instantiated and defined", () => {
                expect(harnessDownload.plugin).toBeDefined();
                expect(harnessDownload.plugin.app).toBe(harnessDownload.app);
            });

            it("should have services initialized", () => {
                expect(harnessDownload.plugin.services).toBeDefined();
            });

            it("should have local database initialized", () => {
                expect(harnessDownload.plugin.localDatabase).toBeDefined();
                expect(harnessDownload.plugin.localDatabase.isReady).toBe(true);
            });

            it("should a file has been synchronised", async () => {
                const expectedContent = "Hello, World!";
                const path = nameFile("store", "md", 0);
                await testFileRead(harnessDownload, path, expectedContent, fileOptions);
            });
            it("should different content of several files have been synchronised", async () => {
                await testFileRead(harnessDownload, nameFile("test-diff-1", "md", 0), "Content A", fileOptions);
                await testFileRead(harnessDownload, nameFile("test-diff-2", "md", 0), "Content B", fileOptions);
                await testFileRead(harnessDownload, nameFile("test-diff-3", "md", 0), "Content C", fileOptions);
            });

            test.each(FILE_SIZE_MD)("should the file %i bytes had been synchronised", async (size) => {
                const content = Array.from(generateFile(size)).join("");
                const path = nameFile("large", "md", size);
                const isTooLarge = harnessDownload.plugin.services.vault.isFileSizeTooLarge(size);
                if (isTooLarge) {
                    const entry = await harnessDownload.plugin.localDatabase.getDBEntry(path as FilePath);
                    console.log(`Skipping file of size ${size} bytes as it is too large to sync.`);
                    expect(entry).toBe(false);
                } else {
                    await testFileRead(harnessDownload, path, content, fileOptions);
                }
            });

            test.each(FILE_SIZE_BINS)("should binary file of size %i bytes had been synchronised", async (size) => {
                const path = nameFile("binary", "bin", size);

                const isTooLarge = harnessDownload.plugin.services.vault.isFileSizeTooLarge(size);
                if (isTooLarge) {
                    const entry = await harnessDownload.plugin.localDatabase.getDBEntry(path as FilePath);
                    console.log(`Skipping file of size ${size} bytes as it is too large to sync.`);
                    expect(entry).toBe(false);
                } else {
                    const content = new Blob([...generateBinaryFile(size)], { type: "application/octet-stream" });
                    await testFileRead(harnessDownload, path, content, fileOptions);
                }
            });
        });
        afterAll(async () => {
            if (harnessDownload) {
                await closeReplication(harnessDownload);
                await harnessDownload.dispose();
                await delay(1000);
            }
            if (harnessUpload) {
                await closeReplication(harnessUpload);
                await harnessUpload.dispose();
                await delay(1000);
            }
        });
        it("Wait for idle state", async () => {
            await delay(100);
        });
    });
}
