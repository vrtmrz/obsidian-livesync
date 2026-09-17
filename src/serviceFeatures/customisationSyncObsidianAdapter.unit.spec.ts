import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    CANCELLED,
    LOG_LEVEL_NOTICE,
    type FilePath,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

const mocks = vi.hoisted(() => ({
    conflictResult: "B" as string | symbol,
    conflictArguments: [] as unknown[],
    conflictOpen: vi.fn(),
    jsonArguments: [] as unknown[],
    jsonOpen: vi.fn(),
    jsonResult: "merged",
    log: vi.fn(),
    manager: {
        enabledPlugins: new Set(["example"]),
        manifests: [{ id: "example", name: "Example", dir: ".obsidian/plugins/example" }],
        loadPlugin: vi.fn(async () => undefined),
        unloadPlugin: vi.fn(async () => undefined),
    },
    periodicArguments: [] as unknown[],
    platform: {
        isAndroidApp: false,
        isIosApp: false,
        isMacOS: true,
        isMobileApp: false,
        isMobile: false,
        isSafari: false,
        isDesktop: true,
        isDesktopApp: true,
    },
    scanCount: { value: 0 },
}));

vi.mock("@/deps.ts", () => ({ Platform: mocks.platform }));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {
        constructor(...args: unknown[]) {
            mocks.periodicArguments = args;
        }
        enable() {}
        disable() {}
    },
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(() => mocks.manager),
}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {
        constructor(...args: unknown[]) {
            mocks.jsonArguments = args;
        }
        open() {
            mocks.jsonOpen();
            const callback = mocks.jsonArguments[3] as (keep?: string, result?: string) => Promise<void>;
            void callback(undefined, mocks.jsonResult);
        }
    },
}));
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class ConflictResolveModal {
        constructor(...args: unknown[]) {
            mocks.conflictArguments = args;
        }
        open() {
            mocks.conflictOpen();
        }
        async waitForResult() {
            return mocks.conflictResult;
        }
    },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores", () => ({
    pluginScanningCount: mocks.scanCount,
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/services/lib/logUtils", () => ({
    createInstanceLogFunction: vi.fn(() => mocks.log),
}));

import { createCustomisationSyncObsidianDependencies } from "./customisationSyncObsidianAdapter.ts";

function createHost() {
    const listResult = { files: [".obsidian/app.json"], folders: [".obsidian/plugins"] };
    const list = vi.fn(async () => listResult);
    const notices = { show: vi.fn(), hide: vi.fn() };
    const firstSettings = { marker: "first" };
    const firstDatabase = { marker: "first-db" };
    const storageAccess = { marker: "storage" };
    const path = { marker: "path" };
    const services = {
        API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
        appLifecycle: {
            askRestart: vi.fn(),
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
        },
        context: {
            app: { vault: { adapter: { list } } },
            notices,
        },
        database: { localDatabase: firstDatabase },
        path,
        replication: { replicateUserInitiated: vi.fn(async () => undefined) },
        setting: {
            settings: firstSettings,
            applyPartial: vi.fn(async () => undefined),
            getDeviceAndVaultName: vi.fn(() => "device-a"),
            saveSettingData: vi.fn(async () => undefined),
            setDeviceAndVaultName: vi.fn(),
        },
        UI: { confirm: { askString: vi.fn(async () => "device-b") } },
    };
    const host = { services, serviceModules: { storageAccess } };
    const getUIControl = vi.fn(() => undefined);
    const ownsLocalDocument = vi.fn(() => true);
    const ownsLocalFile = vi.fn(() => true);
    const dependencies = createCustomisationSyncObsidianDependencies(host as never, {
        getUIControl,
        ownsLocalDocument,
        ownsLocalFile,
    });
    return {
        dependencies,
        firstDatabase,
        firstSettings,
        getUIControl,
        host,
        list,
        listResult,
        notices,
        ownsLocalDocument,
        ownsLocalFile,
        path,
        services,
        storageAccess,
    };
}

describe("Customisation Sync Obsidian adapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.conflictResult = "B";
        mocks.jsonResult = "merged";
        mocks.scanCount.value = 0;
    });

    it("provides live settings and database projections with explicit host telemetry", async () => {
        const fixture = createHost();

        expect(fixture.dependencies.getSettings()).toBe(fixture.firstSettings);
        expect(fixture.dependencies.getLocalDatabase()).toBe(fixture.firstDatabase);
        expect(fixture.dependencies.storageAccess).toBe(fixture.storageAccess);
        expect(fixture.dependencies.path).toBe(fixture.path);

        const replacementSettings = { marker: "replacement" };
        const replacementDatabase = { marker: "replacement-db" };
        fixture.services.setting.settings = replacementSettings;
        fixture.services.database.localDatabase = replacementDatabase;
        expect(fixture.dependencies.getSettings()).toBe(replacementSettings);
        expect(fixture.dependencies.getLocalDatabase()).toBe(replacementDatabase);

        fixture.dependencies.publishScanCount(3);
        expect(mocks.scanCount.value).toBe(3);
        expect(fixture.dependencies.ownsLocalFile(".obsidian/app.json" as FilePath)).toBe(true);
        expect(fixture.dependencies.ownsLocalDocument("ix:device/app.json" as FilePathWithPrefix)).toBe(true);

        const process = vi.fn(async () => undefined);
        fixture.dependencies.createPeriodicProcessor(process);
        expect(mocks.periodicArguments).toEqual([fixture.host, process]);
        await expect(fixture.dependencies.listFiles(".obsidian")).resolves.toBe(fixture.listResult);
        expect(fixture.list).toHaveBeenCalledWith(".obsidian");
    });

    it("owns Obsidian conflict dialogue construction", async () => {
        const { dependencies, host } = createHost();
        const files = [{ path: "local.json" }, { path: "remote.json" }] as never;
        const apply = vi.fn(async () => true);

        await expect(dependencies.resolveJsonConflict("app.json" as FilePath, files, "device-b", apply)).resolves.toBe(
            true
        );
        expect(mocks.jsonOpen).toHaveBeenCalledOnce();
        expect(mocks.jsonArguments.slice(0, 3)).toEqual([host.services.context.app, "app.json", files]);
        expect(mocks.jsonArguments.slice(4)).toEqual([
            "Local",
            "device-b",
            "B",
            true,
            true,
            "Difference between local and remote",
        ]);
        expect(apply).toHaveBeenCalledWith("merged");

        await expect(dependencies.selectTextFile("app.css" as FilePath, {} as never, "device-b")).resolves.toBe("B");
        expect(mocks.conflictOpen).toHaveBeenCalledOnce();
        mocks.conflictResult = CANCELLED;
        await expect(dependencies.selectTextFile("app.css" as FilePath, {} as never, "device-b")).resolves.toBe(false);
    });

    it("owns plug-in reload, Notice, and fallback device-name effects", async () => {
        const { dependencies, notices } = createHost();
        let click: (() => void) | undefined;
        const fragment = {
            createSpan: (_options: unknown, build: (span: unknown) => void) => {
                const span = {
                    appendText: vi.fn(),
                    appendChild: vi.fn(),
                    createEl: (_tag: string, _options: unknown, buildAnchor: (anchor: unknown) => void) => {
                        const anchor = {
                            text: "",
                            addEventListener: (_event: string, callback: () => void) => {
                                click = callback;
                            },
                        };
                        buildAnchor(anchor);
                        return anchor;
                    },
                };
                build(span);
            },
        };
        vi.stubGlobal("createFragment", (build: (value: typeof fragment) => void) => {
            build(fragment);
            return fragment;
        });
        const openDialog = vi.fn();

        await dependencies.reloadPlugin(".obsidian", "example");
        expect(mocks.manager.unloadPlugin).toHaveBeenCalledWith("example");
        expect(mocks.manager.loadPlugin).toHaveBeenCalledWith("example");
        expect(mocks.log).toHaveBeenNthCalledWith(
            1,
            "Unloading plugin: Example",
            LOG_LEVEL_NOTICE,
            "plugin-reload-example"
        );

        dependencies.showConfigurationNotice(openDialog);
        expect(notices.show).toHaveBeenCalledWith("config-sync:updated-configuration", fragment, {
            durationMs: 20_000,
        });
        click?.();
        expect(openDialog).toHaveBeenCalledOnce();
        dependencies.hideConfigurationNotice();
        expect(notices.hide).toHaveBeenCalledWith("config-sync:updated-configuration");
        expect(dependencies.getFallbackDeviceName()).toMatch(/^macos[a-z0-9]{4}$/);
    });
});
