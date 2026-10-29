import { PutObjectCommand } from "@aws-sdk/client-s3";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DEVICE_ID_PREFERRED, MILESTONE_DOCID, NODEINFO_DOCID } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
    type CouchDbDocument,
} from "../runner/couchdb.ts";
import {
    createObjectStorageClient,
    deleteObjectStoragePrefix,
    ensureObjectStorageBucket,
    loadObjectStorageConfig,
    makeUniqueBucketPrefix,
    readObjectStorageJson,
} from "../runner/objectStorage.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    assertE2eCompatibilityUnpaused,
    configureCouchDb,
    configureObjectStorage,
    createE2eCouchDbPluginData,
    createE2eObjectStoragePluginData,
    prepareRemote,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertLocatorWithinViewport,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
import { iPhoneSafeArea, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { openLiveSyncSettings, waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import type { Locator, Page } from "playwright";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_JOINED_DEVICES_TIMEOUT_MS ?? 10000);
const commandId = "obsidian-livesync:joined-devices";
const targetId = "joined-devices-target";
const retainedId = "joined-devices-retained";
const initialPlatform = "E2E Android tablet";
const refreshedPlatform = "E2E refreshed platform";
const connectedAt = Date.UTC(2026, 0, 12, 9, 30, 0);

type SelfDeviceInfo = {
    id: string;
    platform: string;
    pluginVersion: string;
    appVersion: string;
};

type DeviceInfo = {
    device_name: string;
    vault_name: string;
    app_version: string;
    plugin_version: string;
    platform: string;
    progress: string;
    last_connected: number;
};

type JoinedDevicesMilestone = CouchDbDocument & {
    accepted_nodes: string[];
    node_info: Record<string, DeviceInfo>;
    locked: boolean;
    cleaned: boolean;
    node_chunk_info: Record<string, { min: number; max: number; current: number }>;
    tweak_values: Record<string, Record<string, unknown>>;
};

type DeviceFixture = {
    milestone: JoinedDevicesMilestone;
    preferredTweaks: Record<string, unknown>;
};

type JoinedDevicesRemote = {
    label: string;
    pluginData: Record<string, unknown>;
    prepare(): Promise<void>;
    configure(cliBinary: string, env: NodeJS.ProcessEnv): Promise<unknown>;
    read(): Promise<JoinedDevicesMilestone>;
    write(milestone: JoinedDevicesMilestone): Promise<void>;
    cleanup(): Promise<void>;
};

async function createRemoteFixture(): Promise<JoinedDevicesRemote> {
    const args = process.argv.slice(2);
    if (args.some((argument) => argument !== "--object-storage")) {
        throw new Error("Usage: joined-devices.ts [--object-storage]");
    }
    if (args.includes("--object-storage")) {
        const config = await loadObjectStorageConfig();
        const bucketPrefix = makeUniqueBucketPrefix("joined-devices");
        const settings = { ...config, bucketPrefix };
        const key = `${bucketPrefix}_00000000-milestone.json`;
        return {
            label: "Object Storage",
            pluginData: createE2eObjectStoragePluginData(settings),
            prepare: () => ensureObjectStorageBucket(config),
            configure: (cliBinary, env) => configureObjectStorage(cliBinary, env, settings),
            read: () => readObjectStorageJson<JoinedDevicesMilestone>(config, key),
            write: async (milestone) => {
                const client = createObjectStorageClient(config);
                try {
                    await client.send(
                        new PutObjectCommand({
                            Bucket: config.bucket,
                            Key: key,
                            Body: JSON.stringify(milestone),
                            ContentType: "application/json",
                        })
                    );
                } finally {
                    client.destroy();
                }
            },
            cleanup: () => deleteObjectStoragePrefix(config, bucketPrefix),
        };
    }
    const config = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(config.dbPrefix, "joined-devices");
    const settings = { uri: config.uri, username: config.username, password: config.password, dbName };
    return {
        label: "CouchDB",
        pluginData: createE2eCouchDbPluginData(settings),
        prepare: async () => {
            await assertCouchDbReachable(config);
            await createCouchDbDatabase(config, dbName);
        },
        configure: (cliBinary, env) => configureCouchDb(cliBinary, env, settings),
        read: async () => {
            const milestone = await fetchCouchDbDocument(config, dbName, MILESTONE_DOCID);
            assert(Boolean(milestone._rev), "The remote milestone did not have a revision.");
            return milestone as JoinedDevicesMilestone;
        },
        write: async (milestone) => {
            await putCouchDbDocument(config, dbName, milestone);
        },
        cleanup: () => deleteCouchDbDatabase(config, dbName),
    };
}

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

function deviceCard(dialogue: Locator, id: string): Locator {
    return dialogue.locator(".device-card").filter({ hasText: id });
}

async function assertDetail(card: Locator, label: string, expected: string): Promise<void> {
    const rows = card.locator(".device-details > div");
    for (let index = 0; index < (await rows.count()); index++) {
        const row = rows.nth(index);
        if ((await row.locator("dt").innerText()).trim() === label) {
            assertEqual((await row.locator("dd").innerText()).trim(), expected, `${label} did not match.`);
            return;
        }
    }
    throw new Error(`The device details did not contain '${label}'.`);
}

async function readSelfDeviceInfo(cliBinary: string, env: NodeJS.ProcessEnv): Promise<SelfDeviceInfo> {
    return await evalObsidianJson<SelfDeviceInfo>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const nodeInfo=await core.services.database.localDatabase.localDatabase.get(${JSON.stringify(NODEINFO_DOCID)});`,
            "return JSON.stringify({",
            "id:nodeInfo.nodeid,",
            "platform:core.services.API.getPlatform(),",
            "pluginVersion:core.services.API.getPluginVersion(),",
            "appVersion:core.services.API.getAppVersion(),",
            "});",
            "})()",
        ].join(""),
        env
    );
}

function createFixture(self: SelfDeviceInfo): DeviceFixture {
    const preferredTweaks = { customChunkSize: 60, chunkSplitterVersion: "v3-rabin-karp" };
    const milestone: JoinedDevicesMilestone = {
        _id: MILESTONE_DOCID,
        type: "milestoneinfo",
        created: Date.now(),
        // The current device is deliberately absent: it must still be listed first and identified as locked out.
        accepted_nodes: [targetId, retainedId],
        node_info: {
            [targetId]: {
                device_name: "E2E target device",
                vault_name: "Joined devices target fixture",
                app_version: "1.99.0-test",
                plugin_version: "999.0.0",
                platform: initialPlatform,
                progress: "ready",
                last_connected: connectedAt,
            },
            [retainedId]: {
                device_name: "E2E retained device",
                vault_name: "Joined devices retained fixture",
                app_version: "1.88.0-test",
                plugin_version: "0.1.0",
                platform: "E2E Linux desktop",
                progress: "ready",
                last_connected: connectedAt - 86400000,
            },
        },
        locked: true,
        cleaned: true,
        node_chunk_info: {
            [targetId]: { min: 1, max: 3, current: 3 },
            [retainedId]: { min: 1, max: 2, current: 2 },
        },
        tweak_values: {
            [targetId]: { customChunkSize: 48 },
            [retainedId]: { customChunkSize: 60 },
            [DEVICE_ID_PREFERRED]: preferredTweaks,
        },
    };
    assert(self.id !== targetId && self.id !== retainedId, "The local device identity collided with a fixture ID.");
    return { milestone, preferredTweaks };
}

async function openFromRemoteSettings(page: Page): Promise<Locator> {
    const settings = await openLiveSyncSettings(page, uiTimeoutMs);
    const remoteConfiguration = await settings.openPage("Remote Configuration");
    await remoteConfiguration
        .getByRole("button", { name: "Review devices", exact: true })
        .click({ timeout: uiTimeoutMs });
    const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
    await dialogue.getByText(targetId, { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
    return dialogue;
}

async function assertInitialDialogue(dialogue: Locator, self: SelfDeviceInfo, page: Page): Promise<void> {
    const cards = dialogue.locator(".device-card");
    assertEqual(
        await cards.count(),
        3,
        "The joined devices dialogue did not show the self, target, and retained records."
    );
    const selfCard = cards.nth(0);
    assert(Boolean(self.id), "The current device identity was not read from the local NODEINFO_DOCID record.");
    assertEqual(
        (await selfCard.locator("code.device-id").innerText()).trim(),
        self.id,
        "The current device was not listed first."
    );
    await selfCard.getByText("This device", { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
    await selfCard.getByText("Locked out", { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
    await selfCard.getByText("Not accepted", { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
    await selfCard
        .getByText("This device has been locked out.", { exact: false })
        .waitFor({ state: "visible", timeout: uiTimeoutMs });
    await assertDetail(selfCard, "Platform", self.platform);
    await assertDetail(selfCard, "Plug-in version", self.pluginVersion);
    await assertDetail(selfCard, "App version", self.appVersion);
    assertEqual(
        await selfCard.getByRole("button", { name: "Forget device", exact: true }).count(),
        0,
        "The current device exposed a forget control."
    );

    const targetCard = deviceCard(dialogue, targetId);
    await assertDetail(targetCard, "Platform", initialPlatform);
    await assertDetail(targetCard, "Plug-in version", "999.0.0");
    await assertDetail(targetCard, "App version", "1.99.0-test");
    const targetDate = await page.evaluate((timestamp) => new Date(timestamp).toLocaleString(), connectedAt);
    await assertDetail(targetCard, "Last recorded", targetDate);
    await targetCard.getByText("Accepted", { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });

    const retainedCard = deviceCard(dialogue, retainedId);
    await assertDetail(retainedCard, "Platform", "E2E Linux desktop");
    await assertDetail(retainedCard, "Plug-in version", "0.1.0");
    await assertDetail(retainedCard, "App version", "1.88.0-test");
    await dialogue
        .getByText(
            "This list shows device information recorded by the remote. It does not show whether a device is online now.",
            { exact: true }
        )
        .waitFor({ state: "visible", timeout: uiTimeoutMs });
    await dialogue
        .locator(".sls-info-note")
        .getByText(
            "Synchronisation between different plug-in versions is generally safe unless the connection is explicitly blocked. However, it may be less efficient or use more storage, and P2P synchronisation may be unavailable.",
            { exact: true }
        )
        .waitFor({ state: "visible", timeout: uiTimeoutMs });
    await dialogue
        .getByText("This remote is locked.", { exact: false })
        .waitFor({ state: "visible", timeout: uiTimeoutMs });
    await dialogue
        .getByText("This remote has been cleaned.", { exact: false })
        .waitFor({ state: "visible", timeout: uiTimeoutMs });
}

async function refreshRemotePlatform(page: Page, remote: JoinedDevicesRemote): Promise<void> {
    const milestone = await remote.read();
    await remote.write({
        ...milestone,
        node_info: {
            ...milestone.node_info,
            [targetId]: { ...milestone.node_info[targetId], platform: refreshedPlatform },
        },
    });
    const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
    await dialogue.getByRole("button", { name: "Refresh", exact: true }).click({ timeout: uiTimeoutMs });
    await deviceCard(dialogue, targetId).getByText(refreshedPlatform, { exact: true }).waitFor({
        state: "visible",
        timeout: uiTimeoutMs,
    });
}

async function showForgetConfirmation(dialogue: Locator): Promise<void> {
    const targetCard = deviceCard(dialogue, targetId);
    await targetCard.getByRole("button", { name: "Forget device", exact: true }).click({ timeout: uiTimeoutMs });
    await targetCard.getByText("Forget this device record?", { exact: true }).waitFor({
        state: "visible",
        timeout: uiTimeoutMs,
    });
}

async function assertCancelledForget(dialogue: Locator, remote: JoinedDevicesRemote): Promise<void> {
    const before = await remote.read();
    await showForgetConfirmation(dialogue);
    const confirmation = deviceCard(dialogue, targetId).locator(".forget-confirmation");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: uiTimeoutMs });
    await confirmation.waitFor({ state: "detached", timeout: uiTimeoutMs });
    assertEqual(JSON.stringify(await remote.read()), JSON.stringify(before), "Cancelling Forget changed the remote.");
}

async function confirmForgetTarget(dialogue: Locator): Promise<void> {
    const targetCard = deviceCard(dialogue, targetId);
    await targetCard.getByRole("button", { name: "Forget device", exact: true }).click({ timeout: uiTimeoutMs });
    await dialogue.getByText("The device record was forgotten.", { exact: true }).waitFor({
        state: "visible",
        timeout: uiTimeoutMs,
    });
    await targetCard.waitFor({ state: "detached", timeout: uiTimeoutMs });
}

async function assertTargetForgotten(remote: JoinedDevicesRemote, fixture: DeviceFixture): Promise<void> {
    const milestone = await remote.read();
    assertEqual(
        JSON.stringify(milestone.accepted_nodes),
        JSON.stringify([retainedId]),
        "Forgetting changed the wrong accepted device records."
    );
    assertEqual(
        JSON.stringify(Object.keys(milestone.node_info)),
        JSON.stringify([retainedId]),
        "Forgetting changed the wrong device metadata records."
    );
    assertEqual(
        JSON.stringify(Object.keys(milestone.node_chunk_info)),
        JSON.stringify([retainedId]),
        "Forgetting changed the wrong chunk metadata records."
    );
    assertEqual(
        JSON.stringify(Object.keys(milestone.tweak_values).sort()),
        JSON.stringify([DEVICE_ID_PREFERRED, retainedId].sort()),
        "Forgetting changed the wrong tweak metadata records."
    );
    assertEqual(milestone.locked, true, "Forgetting changed the remote lock state.");
    assertEqual(milestone.cleaned, true, "Forgetting changed the remote cleaned state.");
    assertEqual(
        JSON.stringify(milestone.tweak_values[DEVICE_ID_PREFERRED]),
        JSON.stringify(fixture.preferredTweaks),
        "Forgetting changed the preferred-ID tweak record."
    );
    assertEqual(
        JSON.stringify(milestone.node_info[retainedId]),
        JSON.stringify(fixture.milestone.node_info[retainedId]),
        "Forgetting changed the retained device metadata."
    );
}

async function assertScrollableMobileDialogue(page: Page, container: Locator): Promise<void> {
    const dialogue = container.locator(".modal").last();
    const closeButton = container.locator(".modal-close-button, .modal-header-button").last();
    await assertLocatorWithinViewport(page, dialogue, { label: "Joined devices dialogue" });
    await assertNoHorizontalOverflow(page, dialogue, { label: "Joined devices dialogue" });
    await assertLocatorWithinSafeArea(page, dialogue, {
        label: "Joined devices dialogue",
        safeAreaInsets: iPhoneSafeArea,
    });
    const buttons = [closeButton, ...(await dialogue.locator("button:visible").all())];
    for (const button of buttons) {
        // Device records form a scrollable list; every control must be reachable after scrolling.
        await button.scrollIntoViewIfNeeded();
        const label = (await button.innerText()).trim() || "Close dialogue";
        await assertLocatorWithinViewport(page, button, { label });
        await assertLocatorWithinSafeArea(page, button, { label, safeAreaInsets: iPhoneSafeArea });
        await assertNoHorizontalOverflow(page, button, { label });
        await assertLocatorHasMinimumTouchTarget(page, button, { label });
    }
    await container.locator(".modal-content").evaluate((element) => element.scrollTo(0, 0));
}

async function dismissNotices(page: Page): Promise<void> {
    const notices = page.locator(".notice:visible");
    for (let remaining = 20; remaining > 0 && (await notices.count()) > 0; remaining--) {
        const notice = await notices.first().elementHandle();
        if (!notice) continue;
        try {
            await notice.click({ position: { x: 20, y: 20 }, timeout: uiTimeoutMs });
            await notice.waitForElementState("hidden", { timeout: uiTimeoutMs });
        } finally {
            await notice.dispose();
        }
    }
    assertEqual(await notices.count(), 0, "Notices still obscured the dialogue screenshot.");
}

async function captureJoinedDevices(
    port: number,
    filename: string,
    assertReady: (page: Page) => Promise<Locator>
): Promise<void> {
    const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
    await mkdir(outputDirectory, { recursive: true });
    await withObsidianPage(port, async (page) => {
        try {
            const dialogue = await assertReady(page);
            await dialogue.page().screenshot({ path: join(outputDirectory, filename), fullPage: true });
        } catch (error) {
            const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", 500).catch(() => undefined);
            const failurePath = join(outputDirectory, filename.replace(/\.png$/u, ".failure.png"));
            await (dialogue?.page() ?? page).screenshot({ path: failurePath, fullPage: true }).catch(() => undefined);
            console.error(`Joined devices UI failure screenshot: ${failurePath}`);
            throw error;
        }
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const remote = await createRemoteFixture();
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;

    try {
        await remote.prepare();
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: remote.pluginData,
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await assertE2eCompatibilityUnpaused(cli.binary, session.cliEnv, session.remoteDebuggingPort);
        await remote.configure(cli.binary, session.cliEnv);
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await prepareRemote(cli.binary, session.cliEnv);

        const self = await readSelfDeviceInfo(cli.binary, session.cliEnv);
        const fixture = createFixture(self);
        const preparedMilestone = await remote.read();
        await remote.write({
            ...fixture.milestone,
            ...(preparedMilestone._rev ? { _rev: preparedMilestone._rev } : {}),
        });

        await captureJoinedDevices(session.remoteDebuggingPort, "joined-devices-notice.png", async (page) => {
            const dialogue = await openFromRemoteSettings(page);
            const dialoguePage = dialogue.page();
            await dialoguePage.setViewportSize({ width: 1280, height: 1100 });
            await assertInitialDialogue(dialogue, self, dialoguePage);
            const notice = dialoguePage.locator(".notice").filter({
                hasText: "Newer Self-hosted LiveSync versions detected: 999.0.0.",
            });
            await notice.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await notice
                .getByText("Older Self-hosted LiveSync versions detected: 0.1.0.", { exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            assertEqual(
                await notice
                    .getByText("Reviewing and aligning Self-hosted LiveSync versions across devices is recommended.", {
                        exact: true,
                    })
                    .count(),
                1,
                "The version Notice did not contain exactly one recommendation."
            );
            assertEqual(
                await notice.getByRole("button", { name: "Review devices", exact: true }).count(),
                1,
                "The version Notice did not contain exactly one shared review action."
            );
            return dialogue;
        });
        await captureJoinedDevices(session.remoteDebuggingPort, "joined-devices-desktop.png", async (page) => {
            const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
            await dialogue.getByRole("button", { name: "Close", exact: true }).click({ timeout: uiTimeoutMs });
            await dialogue
                .page()
                .locator(".notice")
                .getByRole("button", { name: "Review devices", exact: true })
                .click();
            const reopened = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
            await reopened.getByText(targetId, { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
            await dismissNotices(reopened.page());
            return reopened;
        });
        await captureJoinedDevices(
            session.remoteDebuggingPort,
            "joined-devices-forget-confirmation.png",
            async (page) => {
                await refreshRemotePlatform(page, remote);
                const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
                await assertCancelledForget(dialogue, remote);
                await showForgetConfirmation(dialogue);
                await deviceCard(dialogue, targetId).locator(".forget-confirmation").scrollIntoViewIfNeeded();
                return dialogue;
            }
        );
        await captureJoinedDevices(session.remoteDebuggingPort, "joined-devices-after-forget.png", async (page) => {
            const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
            await confirmForgetTarget(dialogue);
            await dialogue.locator(".modal-content").evaluate((element) => element.scrollTo(0, 0));
            return dialogue;
        });
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
            await dialogue.getByRole("button", { name: "Close", exact: true }).click({ timeout: uiTimeoutMs });
            const settings = await openLiveSyncSettings(page, uiTimeoutMs);
            await settings.close();
        });
        await assertTargetForgotten(remote, fixture);

        await setObsidianMobileTestMode(session.remoteDebuggingPort, true, uiTimeoutMs);
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await captureJoinedDevices(session.remoteDebuggingPort, "joined-devices-mobile.png", async (page) => {
            const opened = await page.evaluate((id) => {
                const app = (
                    window as typeof window & {
                        app?: { commands?: { executeCommandById?(commandId: string): boolean } };
                    }
                ).app;
                return app?.commands?.executeCommandById?.(id) === true;
            }, commandId);
            assert(opened, "The Joined devices command did not open the dialogue.");
            const dialogue = await waitForVisibleObsidianDialogue(page, "Joined devices", uiTimeoutMs);
            await dialogue.getByText(retainedId, { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
            await assertScrollableMobileDialogue(dialogue.page(), dialogue);
            assertEqual(
                await dialogue.locator(".device-card").count(),
                2,
                "The refreshed mobile list did not retain both remaining devices."
            );
            await dismissNotices(dialogue.page());
            return dialogue;
        });

        console.log(`Joined devices scenario passed against ${remote.label}.`);
    } finally {
        try {
            if (session) await session.app.stop();
        } finally {
            try {
                await vault.dispose();
            } finally {
                await remote.cleanup();
            }
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
