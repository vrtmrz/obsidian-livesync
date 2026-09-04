import { describe, expect, it, vi } from "vitest";

const operationMocks = vi.hoisted(() => ({
    checkCompromisedChunks: vi.fn(),
    checkIncompleteDocuments: vi.fn(),
    migrateBulkSendSetting: vi.fn(),
    runConfigDoctor: vi.fn(),
}));

vi.mock("./compromisedChunks", () => ({
    checkCompromisedChunks: operationMocks.checkCompromisedChunks,
}));
vi.mock("./incompleteDocuments", () => ({
    checkIncompleteDocuments: operationMocks.checkIncompleteDocuments,
}));
vi.mock("./bulkSettingMigration", () => ({
    migrateBulkSendSetting: operationMocks.migrateBulkSendSetting,
}));
vi.mock("./configDoctor", () => ({
    runConfigDoctor: operationMocks.runConfigDoctor,
}));

import { useStartupLifecycleFeature, type StartupLifecycleHost } from "./index";

describe("useStartupLifecycleFeature default operation wiring", () => {
    it("maps the host services to every configured start-up operation in order", async () => {
        const order: string[] = [];
        const log = vi.fn();
        const settings = { isConfigured: true, encrypt: true, sendChunksBulk: false, sendChunksBulkMaxSize: 1 };
        const localDatabase = { isReady: true, localDatabase: { name: "local" } };
        const confirm = { askSelectStringDialogue: vi.fn() };
        const activeReplicator = { name: "remote" };
        const storageAccess = { name: "storage" };
        const fileHandler = { name: "file-handler" };
        const rebuilder = { name: "rebuilder" };
        const kvDB = { name: "key-value" };
        const addLayoutHandler = vi.fn();
        const addFirstInitialiseHandler = vi.fn();
        const setting = {
            settings,
            currentSettings: vi.fn(() => settings),
            saveSettingData: vi.fn(async () => undefined),
        };
        const appLifecycle = {
            onLayoutReady: { addHandler: addLayoutHandler },
            onFirstInitialise: { addHandler: addFirstInitialiseHandler },
            performRestart: vi.fn(),
        };
        const path = { getPath: vi.fn(() => "note.md") };
        const vault = { isTargetFile: vi.fn(async () => true) };
        const host = {
            services: {
                API: { isOnline: true },
                UI: { confirm },
                appLifecycle,
                context: {
                    events: { onEvent: vi.fn(() => vi.fn()) },
                    noticeGroups: { setItem: vi.fn(), finish: vi.fn() },
                    translate: String,
                },
                database: { localDatabase },
                keyValueDB: { kvDB },
                path,
                replicator: { getActiveReplicator: vi.fn(() => activeReplicator) },
                setting,
                vault,
            },
            serviceModules: { fileHandler, rebuilder, storageAccess },
        } as unknown as StartupLifecycleHost;

        operationMocks.checkCompromisedChunks.mockImplementation(async () => {
            order.push("compromised");
            return true;
        });
        operationMocks.checkIncompleteDocuments.mockImplementation(async () => {
            order.push("incomplete");
            return true;
        });
        operationMocks.runConfigDoctor.mockImplementation(async () => {
            order.push("doctor");
            return true;
        });
        operationMocks.migrateBulkSendSetting.mockImplementation(async () => {
            order.push("bulk");
        });
        const waitForCompatibilityReview = vi.fn(async () => {
            order.push("compatibility");
        });

        useStartupLifecycleFeature(host, {
            inviteToOnboarding: vi.fn(),
            waitForCompatibilityReview,
            log,
        });

        expect(operationMocks.checkCompromisedChunks).not.toHaveBeenCalled();
        expect(operationMocks.checkIncompleteDocuments).not.toHaveBeenCalled();
        expect(operationMocks.runConfigDoctor).not.toHaveBeenCalled();
        expect(operationMocks.migrateBulkSendSetting).not.toHaveBeenCalled();
        expect(waitForCompatibilityReview).not.toHaveBeenCalled();

        const layoutAdmission = addLayoutHandler.mock.calls[0]?.[0] as () => Promise<boolean>;
        const firstInitialise = addFirstInitialiseHandler.mock.calls[0]?.[0] as () => Promise<boolean>;
        await expect(layoutAdmission()).resolves.toBe(true);
        await expect(firstInitialise()).resolves.toBe(true);

        expect(order).toEqual(["compromised", "incomplete", "compatibility", "doctor", "bulk"]);

        const compromised = operationMocks.checkCompromisedChunks.mock.calls[0]?.[0];
        expect(compromised).toMatchObject({ settings, localDatabase, confirm, rebuilder, log });
        expect(compromised?.isOnline()).toBe(true);
        expect(compromised?.getActiveReplicator()).toBe(activeReplicator);
        compromised?.performRestart();
        expect(appLifecycle.performRestart).toHaveBeenCalledOnce();

        const [incomplete, force] = operationMocks.checkIncompleteDocuments.mock.calls[0] ?? [];
        expect(force).toBe(false);
        expect(incomplete).toMatchObject({ localDatabase, storageAccess, fileHandler, keyValueDB: kvDB, confirm, log });
        expect(incomplete?.getPath({} as never)).toBe("note.md");
        await expect(incomplete?.isTargetFile("note.md")).resolves.toBe(true);

        const doctor = operationMocks.runConfigDoctor.mock.calls[0]?.[0];
        expect(doctor).toMatchObject({ confirm, settings, rebuilder });
        const nextSettings = { ...settings, liveSync: true } as never;
        doctor?.setSettings(nextSettings);
        expect(setting.settings).toBe(nextSettings);
        await doctor?.saveSettings();
        expect(setting.saveSettingData).toHaveBeenCalledOnce();

        const bulk = operationMocks.migrateBulkSendSetting.mock.calls[0]?.[0];
        expect(bulk).toMatchObject({ settings, log });
        await bulk?.saveSettings();
        expect(setting.saveSettingData).toHaveBeenCalledTimes(2);
    });
});
