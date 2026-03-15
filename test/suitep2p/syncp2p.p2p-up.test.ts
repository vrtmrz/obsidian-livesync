/**
 * P2P Replication Tests — Upload phase (process 1 of 2)
 *
 * Executed by run-p2p-tests.sh as the first vitest process.
 * Writes files into the local DB, replicates them to the CLI host,
 * then writes a handoff JSON so the download process knows what to verify.
 *
 * Trystero has module-level global state (occupiedRooms, didInit, etc.)
 * that cannot be safely reused across upload→download within the same
 * browser process.  Running upload and download as separate vitest
 * invocations gives each phase a fresh browser context.
 */
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { generateHarness, waitForIdle, waitForReady, type LiveSyncHarness } from "../harness/harness";
import {
    PREFERRED_SETTING_SELF_HOSTED,
    RemoteTypes,
    type ObsidianLiveSyncSettings,
    AutoAccepting,
} from "@/lib/src/common/types";
import {
    DummyFileSourceInisialised,
    FILE_SIZE_BINS,
    FILE_SIZE_MD,
    generateBinaryFile,
    generateFile,
} from "../utils/dummyfile";
import { checkStoredFileInDB, defaultFileOption, testFileWrite } from "../suite/db_common";
import { delay } from "@/lib/src/common/utils";
import { closeReplication, performReplication } from "./sync_common_p2p";
import { settingBase } from "../suite/variables";

const env = (import.meta as any).env;

const ROOM_ID: string = env.P2P_TEST_ROOM_ID ?? "p2p-test-room";
const PASSPHRASE: string = env.P2P_TEST_PASSPHRASE ?? "p2p-test-pass";
const HOST_PEER_NAME: string = env.P2P_TEST_HOST_PEER_NAME ?? "p2p-cli-host";
const RELAY: string = env.P2P_TEST_RELAY ?? "ws://localhost:4000/";
const APP_ID: string = env.P2P_TEST_APP_ID ?? "self-hosted-livesync-vitest-p2p";
const UPLOAD_PEER_NAME: string = env.P2P_TEST_UPLOAD_PEER_NAME ?? `p2p-upload-${Date.now()}`;
const UPLOAD_VAULT_NAME: string = env.P2P_TEST_UPLOAD_VAULT_NAME ?? `TestVaultUpload-${Date.now()}`;
// Path written by run-p2p-tests.sh; the download phase reads it back.
const HANDOFF_FILE: string = env.P2P_TEST_HANDOFF_FILE ?? "/tmp/p2p-test-handoff.json";

console.log("[P2P Up] ROOM_ID:", ROOM_ID, "HOST:", HOST_PEER_NAME, "RELAY:", RELAY, "APP_ID:", APP_ID);
console.log("[P2P Up] HANDOFF_FILE:", HANDOFF_FILE);

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

/** Write the handoff JSON so the download phase knows which files to verify. */
async function writeHandoff() {
    const handoff = {
        fileSizeMd: FILE_SIZE_MD,
        fileSizeBins: FILE_SIZE_BINS,
    };
    const { commands } = await import("@vitest/browser/context");
    await commands.writeHandoffFile(HANDOFF_FILE, JSON.stringify(handoff));
    console.log("[P2P Up] handoff written to", HANDOFF_FILE);
}

describe("P2P Replication — Upload", () => {
    let harnessUpload: LiveSyncHarness;

    const uploadSetting: ObsidianLiveSyncSettings = {
        ...p2pSetting,
        P2P_DevicePeerName: UPLOAD_PEER_NAME,
    };

    beforeAll(async () => {
        await DummyFileSourceInisialised;
        const vaultName = UPLOAD_VAULT_NAME;
        console.log(`[P2P Up] BeforeAll - Vault: ${vaultName}`);
        console.log(`[P2P Up] Peer name: ${UPLOAD_PEER_NAME}`);
        harnessUpload = await generateHarness(vaultName, uploadSetting);
        await waitForReady(harnessUpload);
        expect(harnessUpload.plugin).toBeDefined();
        await waitForIdle(harnessUpload);
    });

    afterAll(async () => {
        await closeReplication(harnessUpload);
        await harnessUpload.dispose();
        await delay(1000);
    });

    it("should be instantiated and defined", () => {
        expect(harnessUpload.plugin).toBeDefined();
        expect(harnessUpload.plugin.app).toBe(harnessUpload.app);
    });

    it("should have services initialized", () => {
        expect(harnessUpload.plugin.core.services).toBeDefined();
    });

    it("should have local database initialized", () => {
        expect(harnessUpload.plugin.core.localDatabase).toBeDefined();
        expect(harnessUpload.plugin.core.localDatabase.isReady).toBe(true);
    });

    it("should create a file", async () => {
        await testFileWrite(harnessUpload, nameFile("store", "md", 0), "Hello, World!", false, fileOptions);
    });

    it("should create several files with different content", async () => {
        await testFileWrite(harnessUpload, nameFile("test-diff-1", "md", 0), "Content A", false, fileOptions);
        await testFileWrite(harnessUpload, nameFile("test-diff-2", "md", 0), "Content B", false, fileOptions);
        await testFileWrite(harnessUpload, nameFile("test-diff-3", "md", 0), "Content C", false, fileOptions);
    });

    test.each(FILE_SIZE_MD)("should create large md file of size %i bytes", async (size) => {
        const content = Array.from(generateFile(size)).join("");
        const path = nameFile("large", "md", size);
        const isTooLarge = harnessUpload.plugin.core.services.vault.isFileSizeTooLarge(size);
        if (isTooLarge) {
            expect(true).toBe(true);
        } else {
            await testFileWrite(harnessUpload, path, content, false, fileOptions);
        }
    });

    test.each(FILE_SIZE_BINS)("should create binary file of size %i bytes", async (size) => {
        const content = new Blob([...generateBinaryFile(size)], { type: "application/octet-stream" });
        const path = nameFile("binary", "bin", size);
        await testFileWrite(harnessUpload, path, content, true, fileOptions);
        const isTooLarge = harnessUpload.plugin.core.services.vault.isFileSizeTooLarge(size);
        if (!isTooLarge) {
            await checkStoredFileInDB(harnessUpload, path, content, fileOptions);
        }
    });

    it("should replicate uploads to CLI host", async () => {
        await performReplication(harnessUpload);
        await performReplication(harnessUpload);
    });

    it("should write handoff file for download phase", async () => {
        await writeHandoff();
    });
});
