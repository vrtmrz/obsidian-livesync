/**
 * P2P Replication Tests — Download phase (process 2 of 2)
 *
 * Executed by run-p2p-tests.sh as the second vitest process, after the
 * upload phase has completed and the CLI host holds all the data.
 *
 * Reads the handoff JSON written by the upload phase to know which files
 * to verify, then replicates from the CLI host and checks every file.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, test } from "vitest";
import { generateHarness, waitForIdle, waitForReady, type LiveSyncHarness } from "../harness/harness";
import {
    PREFERRED_SETTING_SELF_HOSTED,
    RemoteTypes,
    type FilePath,
    type ObsidianLiveSyncSettings,
    AutoAccepting,
} from "@/lib/src/common/types";
import { DummyFileSourceInisialised, generateBinaryFile, generateFile } from "../utils/dummyfile";
import { defaultFileOption, testFileRead } from "../suite/db_common";
import { delay } from "@/lib/src/common/utils";
import { closeReplication, performReplication } from "./sync_common_p2p";
import { settingBase } from "../suite/variables";

const env = (import.meta as any).env;

const ROOM_ID: string = env.P2P_TEST_ROOM_ID ?? "p2p-test-room";
const PASSPHRASE: string = env.P2P_TEST_PASSPHRASE ?? "p2p-test-pass";
const HOST_PEER_NAME: string = env.P2P_TEST_HOST_PEER_NAME ?? "p2p-cli-host";
const RELAY: string = env.P2P_TEST_RELAY ?? "ws://localhost:4000/";
const APP_ID: string = env.P2P_TEST_APP_ID ?? "self-hosted-livesync-vitest-p2p";
const DOWNLOAD_PEER_NAME: string = env.P2P_TEST_DOWNLOAD_PEER_NAME ?? `p2p-download-${Date.now()}`;
const DOWNLOAD_VAULT_NAME: string = env.P2P_TEST_DOWNLOAD_VAULT_NAME ?? `TestVaultDownload-${Date.now()}`;
const HANDOFF_FILE: string = env.P2P_TEST_HANDOFF_FILE ?? "/tmp/p2p-test-handoff.json";

console.log("[P2P Down] ROOM_ID:", ROOM_ID, "HOST:", HOST_PEER_NAME, "RELAY:", RELAY, "APP_ID:", APP_ID);
console.log("[P2P Down] HANDOFF_FILE:", HANDOFF_FILE);

const p2pSetting: ObsidianLiveSyncSettings = {
    ...settingBase,
    ...PREFERRED_SETTING_SELF_HOSTED,
    showVerboseLog: true,
    remoteType: RemoteTypes.REMOTE_P2P,
    encrypt: true,
    passphrase: PASSPHRASE,
    usePathObfuscation: true,
    P2P_Enabled: true,
    P2P_AppID: APP_ID,
    handleFilenameCaseSensitive: false,
    P2P_AutoAccepting: AutoAccepting.ALL,
    P2P_AutoBroadcast: true,
    P2P_AutoStart: true,
    P2P_passphrase: PASSPHRASE,
    P2P_roomID: ROOM_ID,
    P2P_relays: RELAY,
    P2P_AutoAcceptingPeers: "~.*",
    P2P_SyncOnReplication: HOST_PEER_NAME,
};

const fileOptions = defaultFileOption;
const nameFile = (type: string, ext: string, size: number) => `p2p-cli-test-${type}-file-${size}.${ext}`;

/** Read the handoff JSON produced by the upload phase. */
async function readHandoff(): Promise<{ fileSizeMd: number[]; fileSizeBins: number[] }> {
    const { commands } = await import("@vitest/browser/context");
    const raw = await commands.readHandoffFile(HANDOFF_FILE);
    return JSON.parse(raw);
}

describe("P2P Replication — Download", () => {
    let harnessDownload: LiveSyncHarness;
    let fileSizeMd: number[] = [];
    let fileSizeBins: number[] = [];

    const downloadSetting: ObsidianLiveSyncSettings = {
        ...p2pSetting,
        P2P_DevicePeerName: DOWNLOAD_PEER_NAME,
    };

    beforeAll(async () => {
        await DummyFileSourceInisialised;

        const handoff = await readHandoff();
        fileSizeMd = handoff.fileSizeMd;
        fileSizeBins = handoff.fileSizeBins;
        console.log("[P2P Down] handoff loaded — md sizes:", fileSizeMd, "bin sizes:", fileSizeBins);

        const vaultName = DOWNLOAD_VAULT_NAME;
        console.log(`[P2P Down] BeforeAll - Vault: ${vaultName}`);
        console.log(`[P2P Down] Peer name: ${DOWNLOAD_PEER_NAME}`);
        harnessDownload = await generateHarness(vaultName, downloadSetting);
        await waitForReady(harnessDownload);

        await performReplication(harnessDownload);
        await waitForIdle(harnessDownload);
        await delay(1000);
        await performReplication(harnessDownload);
        await waitForIdle(harnessDownload);
        await delay(3000);
    });
    beforeEach(async () => {
        await performReplication(harnessDownload);
        await waitForIdle(harnessDownload);
    });

    afterAll(async () => {
        await closeReplication(harnessDownload);
        await harnessDownload.dispose();
        await delay(1000);
    });

    it("should be instantiated and defined", () => {
        expect(harnessDownload.plugin).toBeDefined();
        expect(harnessDownload.plugin.app).toBe(harnessDownload.app);
    });

    it("should have services initialized", () => {
        expect(harnessDownload.plugin.core.services).toBeDefined();
    });

    it("should have local database initialized", () => {
        expect(harnessDownload.plugin.core.localDatabase).toBeDefined();
        expect(harnessDownload.plugin.core.localDatabase.isReady).toBe(true);
    });

    it("should have synchronised the stored file", async () => {
        await testFileRead(harnessDownload, nameFile("store", "md", 0), "Hello, World!", fileOptions);
    });

    it("should have synchronised files with different content", async () => {
        await testFileRead(harnessDownload, nameFile("test-diff-1", "md", 0), "Content A", fileOptions);
        await testFileRead(harnessDownload, nameFile("test-diff-2", "md", 0), "Content B", fileOptions);
        await testFileRead(harnessDownload, nameFile("test-diff-3", "md", 0), "Content C", fileOptions);
    });

    // NOTE: test.each cannot use variables populated in beforeAll, so we use
    // a single it() that iterates over the sizes loaded from the handoff file.
    it("should have synchronised all large md files", async () => {
        for (const size of fileSizeMd) {
            const content = Array.from(generateFile(size)).join("");
            const path = nameFile("large", "md", size);
            const isTooLarge = harnessDownload.plugin.core.services.vault.isFileSizeTooLarge(size);
            if (isTooLarge) {
                const entry = await harnessDownload.plugin.core.localDatabase.getDBEntry(path as FilePath);
                expect(entry).toBe(false);
            } else {
                await testFileRead(harnessDownload, path, content, fileOptions);
            }
        }
    });

    it("should have synchronised all binary files", async () => {
        for (const size of fileSizeBins) {
            const path = nameFile("binary", "bin", size);
            const isTooLarge = harnessDownload.plugin.core.services.vault.isFileSizeTooLarge(size);
            if (isTooLarge) {
                const entry = await harnessDownload.plugin.core.localDatabase.getDBEntry(path as FilePath);
                expect(entry).toBe(false);
            } else {
                const content = new Blob([...generateBinaryFile(size)], { type: "application/octet-stream" });
                await testFileRead(harnessDownload, path, content, fileOptions);
            }
        }
    });
});
