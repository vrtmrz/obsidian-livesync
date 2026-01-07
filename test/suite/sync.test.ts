// Functional Test on Main Cases
// This test suite only covers main functional cases of synchronisation. Event handling, error cases,
// and edge, resolving conflicts, etc. will be covered in separate test suites.
import { beforeAll, describe, expect, it, test } from "vitest";
import { generateHarness, waitForIdle, waitForReady, type LiveSyncHarness } from "../harness/harness";
import {
    DEFAULT_SETTINGS,
    PREFERRED_JOURNAL_SYNC,
    PREFERRED_SETTING_SELF_HOSTED,
    RemoteTypes,
    type FilePath,
    type ObsidianLiveSyncSettings,
} from "@/lib/src/common/types";

import {
    DummyFileSourceInisialised,
    FILE_SIZE_BINS,
    FILE_SIZE_MD,
    generateBinaryFile,
    generateFile,
} from "../utils/dummyfile";
import { checkStoredFileInDB, defaultFileOption, testFileRead, testFileWrite } from "./db_common";
import { delay } from "@/lib/src/common/utils";
const env = (import.meta as any).env;
const sync_test_setting_base = {
    ...DEFAULT_SETTINGS,
    isConfigured: true,
    handleFilenameCaseSensitive: false,
    couchDB_URI: `${env.hostname}`,
    couchDB_DBNAME: `${env.dbname}`,
    couchDB_USER: `${env.username}`,
    couchDB_PASSWORD: `${env.password}`,
    bucket: `${env.bucketName}`,
    region: "us-east-1",
    endpoint: `${env.minioEndpoint}`,
    accessKey: `${env.accessKey}`,
    secretKey: `${env.secretKey}`,
    useCustomRequestHandler: true,
    forcePathStyle: true,
    bucketPrefix: "",
} as ObsidianLiveSyncSettings;

function generateName(prefix: string, type: string, ext: string, size: number) {
    return `${prefix}-${type}-file-${size}.${ext}`;
}

function* generateCase() {
    const passpharse = "thetest-Passphrase3+9-for-e2ee!";
    const REMOTE_RECOMMENDED = {
        [RemoteTypes.REMOTE_COUCHDB]: PREFERRED_SETTING_SELF_HOSTED,
        [RemoteTypes.REMOTE_MINIO]: PREFERRED_JOURNAL_SYNC,
    };
    for (const remoteType of [RemoteTypes.REMOTE_MINIO, RemoteTypes.REMOTE_COUCHDB]) {
        for (const useE2EE of [false, true]) {
            yield {
                setting: {
                    ...sync_test_setting_base,
                    ...REMOTE_RECOMMENDED[remoteType],
                    remoteType,
                    encrypt: useE2EE,
                    passphrase: useE2EE ? passpharse : "",
                    usePathObfuscation: useE2EE,
                } as ObsidianLiveSyncSettings,
            };
        }
    }
}

const cases = Array.from(generateCase());
const fileOptions = defaultFileOption;
async function prepareRemote(harness: LiveSyncHarness, setting: ObsidianLiveSyncSettings, shouldReset = false) {
    if (shouldReset) {
        await delay(1000);
        await harness.plugin.services.replicator.getActiveReplicator()?.tryResetRemoteDatabase(harness.plugin.settings);
    } else {
        await harness.plugin.services.replicator
            .getActiveReplicator()
            ?.tryCreateRemoteDatabase(harness.plugin.settings);
    }
    await harness.plugin.services.replicator.getActiveReplicator()?.markRemoteResolved(harness.plugin.settings);
    // No exceptions should be thrown
    const status = await harness.plugin.services.replicator
        .getActiveReplicator()
        ?.getRemoteStatus(harness.plugin.settings);
    console.log("Remote status:", status);
    expect(status).not.toBeFalsy();
}

describe("Replication Suite Tests", async () => {
    describe.each(cases)("Replication Tests - Remote: $setting.remoteType, E2EE: $setting.encrypt", ({ setting }) => {
        const nameFile = (type: string, ext: string, size: number) => generateName("sync-test", type, ext, size);
        beforeAll(async () => {
            await DummyFileSourceInisialised;
        });

        describe("Remote Database Initialization", async () => {
            let harnessInit: LiveSyncHarness;
            const sync_test_setting_init = {
                ...setting,
            } as ObsidianLiveSyncSettings;

            it("should initialize remote database", async () => {
                const vaultName = "TestVault" + Date.now();
                console.log(`BeforeEach - Remote Database Initialization - Vault: ${vaultName}`);
                harnessInit = await generateHarness(vaultName, sync_test_setting_init);
                await waitForReady(harnessInit);
                expect(harnessInit.plugin).toBeDefined();
                expect(harnessInit.plugin.app).toBe(harnessInit.app);
                await waitForIdle(harnessInit);
            });

            it("should reset remote database", async () => {
                // harnessInit = await generateHarness(vaultName, sync_test_setting_init);
                await waitForReady(harnessInit);
                await prepareRemote(harnessInit, sync_test_setting_init, true);
            });
            it("should be prepared for replication", async () => {
                // harnessInit = await generateHarness(vaultName, sync_test_setting_init);
                await waitForReady(harnessInit);
                // await prepareRemote(harness, sync_test_setting_init, false);
                const status = await harnessInit.plugin.services.replicator
                    .getActiveReplicator()
                    ?.getRemoteStatus(sync_test_setting_init);
                console.log("Connected devices after reset:", status);
                expect(status).not.toBeFalsy();
            });
        });

        describe("Replication - Upload", async () => {
            let harnessUpload: LiveSyncHarness;

            const sync_test_setting_upload = {
                ...setting,
            } as ObsidianLiveSyncSettings;

            it("Setup Upload Harness", async () => {
                const vaultName = "TestVault" + Date.now();
                console.log(`BeforeAll - Replication Upload - Vault: ${vaultName}`);
                harnessUpload = await generateHarness(vaultName, sync_test_setting_upload);
                await waitForReady(harnessUpload);
                expect(harnessUpload.plugin).toBeDefined();
                expect(harnessUpload.plugin.app).toBe(harnessUpload.app);
                waitForIdle(harnessUpload);
            });

            it("should be instantiated and defined", async () => {
                expect(harnessUpload.plugin).toBeDefined();
                expect(harnessUpload.plugin.app).toBe(harnessUpload.app);
            });

            it("should have services initialized", async () => {
                expect(harnessUpload.plugin.services).toBeDefined();
            });

            it("should have local database initialized", async () => {
                expect(harnessUpload.plugin.localDatabase).toBeDefined();
                expect(harnessUpload.plugin.localDatabase.isReady).toBe(true);
            });

            it("should prepare remote database", async () => {
                await prepareRemote(harnessUpload, sync_test_setting_upload, false);
            });

            // describe("File Creation", async () => {
            it("should store single file", async () => {
                const content = "Hello, World!";
                const path = nameFile("store", "md", 0);
                await testFileWrite(harnessUpload, path, content, false, fileOptions);
                // Perform replication
                // await harness.plugin.services.replication.replicate(true);
            });
            it("should different content of several files are stored correctly", async () => {
                await testFileWrite(harnessUpload, nameFile("test-diff-1", "md", 0), "Content A", false, fileOptions);
                await testFileWrite(harnessUpload, nameFile("test-diff-2", "md", 0), "Content B", false, fileOptions);
                await testFileWrite(harnessUpload, nameFile("test-diff-3", "md", 0), "Content C", false, fileOptions);
            });

            test.each(FILE_SIZE_MD)("should handle large file of size %i bytes", async (size) => {
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

            test.each(FILE_SIZE_BINS)("should handle binary file of size %i bytes", async (size) => {
                // const isTooLarge = harness.plugin.services.vault.isFileSizeTooLarge(size);
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
            // });
            // Perform final replication after all tests
            it("Replication after uploads", async () => {
                await harnessUpload.plugin.services.replication.replicate(true);
                await waitForIdle(harnessUpload);
                // Ensure all files are uploaded
                await harnessUpload.plugin.services.replication.replicate(true);
                await waitForIdle(harnessUpload);
            });
        });

        describe("Replication - Download", async () => {
            let harnessDownload: LiveSyncHarness;
            // Download into a new vault
            const sync_test_setting_download = {
                ...setting,
            } as ObsidianLiveSyncSettings;
            it("should initialize remote database", async () => {
                const vaultName = "TestVault" + Date.now();
                harnessDownload = await generateHarness(vaultName, sync_test_setting_download);
                await waitForReady(harnessDownload);
                await prepareRemote(harnessDownload, sync_test_setting_download, false);
                await harnessDownload.plugin.services.replication.replicate(true);
                await waitForIdle(harnessDownload);
                // Version info might be downloaded, and then replication will be interrupted,
                await harnessDownload.plugin.services.replication.replicate(true); // Ensure all files are downloaded
                await waitForIdle(harnessDownload);
            });

            it("should perform initial replication to download files", async () => {
                await harnessDownload.plugin.services.replicator
                    .getActiveReplicator()
                    ?.markRemoteResolved(sync_test_setting_download);
                await harnessDownload.plugin.services.replication.replicate(true);
                await waitForIdle(harnessDownload);
                // Version info might be downloaded, and then replication will be interrupted,
                await harnessDownload.plugin.services.replication.replicate(true); // Ensure all files are downloaded
                await waitForIdle(harnessDownload);
            });

            it("should be instantiated and defined", async () => {
                expect(harnessDownload.plugin).toBeDefined();
                expect(harnessDownload.plugin.app).toBe(harnessDownload.app);
            });

            it("should have services initialized", async () => {
                expect(harnessDownload.plugin.services).toBeDefined();
            });

            it("should have local database initialized", async () => {
                expect(harnessDownload.plugin.localDatabase).toBeDefined();
                expect(harnessDownload.plugin.localDatabase.isReady).toBe(true);
            });
            // describe("File Checking", async () => {
            it("should retrieve the single file", async () => {
                const expectedContent = "Hello, World!";
                const path = nameFile("store", "md", 0);
                await testFileRead(harnessDownload, path, expectedContent, fileOptions);
            });
            it("should retrieve different content of several files correctly", async () => {
                await testFileRead(harnessDownload, nameFile("test-diff-1", "md", 0), "Content A", fileOptions);
                await testFileRead(harnessDownload, nameFile("test-diff-2", "md", 0), "Content B", fileOptions);
                await testFileRead(harnessDownload, nameFile("test-diff-3", "md", 0), "Content C", fileOptions);
            });

            test.each(FILE_SIZE_MD)("should retrieve the file %i bytes", async (size) => {
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

            test.each(FILE_SIZE_BINS)("should handle binary file of size %i bytes", async (size) => {
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
            // });
        });
        it("Wait for idle state", async () => {
            await delay(100);
        });
    });
});
