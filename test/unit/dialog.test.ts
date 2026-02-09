// Dialog Unit Tests
import { beforeAll, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";

import { generateHarness, waitForIdle, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { ChunkAlgorithms, DEFAULT_SETTINGS, type ObsidianLiveSyncSettings } from "@/lib/src/common/types";

import { DummyFileSourceInisialised } from "../utils/dummyfile";

import { page } from "vitest/browser";
import { DoctorRegulation } from "@/lib/src/common/configForDoc";
import { waitForDialogHidden, waitForDialogShown } from "../lib/ui";
const env = (import.meta as any).env;
const dialog_setting_base = {
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
    usePluginSyncV2: true,
    chunkSplitterVersion: ChunkAlgorithms.RabinKarp,
    doctorProcessedVersion: DoctorRegulation.version,
    notifyThresholdOfRemoteStorageSize: 800,
} as ObsidianLiveSyncSettings;

function checkDialogVisibility(dialogText: string, shouldBeVisible: boolean): void {
    const dialog = page.getByText(dialogText);
    expect(dialog).toHaveClass(/modal-title/);
    if (!shouldBeVisible) {
        expect(dialog).not.toBeVisible();
    } else {
        expect(dialog).toBeVisible();
    }
    return;
}
function checkDialogShown(dialogText: string) {
    checkDialogVisibility(dialogText, true);
}
function checkDialogHidden(dialogText: string) {
    checkDialogVisibility(dialogText, false);
}

describe("Dialog Tests", async () => {
    // describe.each(cases)("Replication Tests - Remote: $setting.remoteType, E2EE: $setting.encrypt", ({ setting }) => {
    const setting = dialog_setting_base;
    beforeAll(async () => {
        await DummyFileSourceInisialised;
        await commands.grantClipboardPermissions();
    });
    let harness: LiveSyncHarness;
    const vaultName = "TestVault" + Date.now();
    beforeAll(async () => {
        harness = await generateHarness(vaultName, setting);
        await waitForReady(harness);
        expect(harness.plugin).toBeDefined();
        expect(harness.plugin.app).toBe(harness.app);
        await waitForIdle(harness);
    });
    it("should show copy to clipboard dialog and confirm", async () => {
        const testString = "This is a test string to copy to clipboard.";
        const title = "Copy Test";
        const result = harness.plugin.services.UI.promptCopyToClipboard(title, testString);
        const isDialogShown = await waitForDialogShown(title, 500);
        expect(isDialogShown).toBe(true);
        const copyButton = page.getByText("📋");
        expect(copyButton).toBeDefined();
        expect(copyButton).toBeVisible();
        await copyButton.click();
        const copyResultButton = page.getByText("✔️");
        expect(copyResultButton).toBeDefined();
        expect(copyResultButton).toBeVisible();
        const clipboardText = await navigator.clipboard.readText();
        expect(clipboardText).toBe(testString);
        const okButton = page.getByText("OK");
        expect(okButton).toBeDefined();
        expect(okButton).toBeVisible();
        await okButton.click();
        const resultValue = await result;
        expect(resultValue).toBe(true);
        // Check that the dialog is closed
        const isDialogHidden = await waitForDialogHidden(title, 500);
        expect(isDialogHidden).toBe(true);
    });
});
