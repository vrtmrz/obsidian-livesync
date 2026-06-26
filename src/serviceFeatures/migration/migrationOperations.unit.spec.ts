import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    performDoctorConsultation: vi.fn(),
    countCompromisedChunks: vi.fn(),
    startOnBoarding: vi.fn(),
    onEvent: vi.fn(),
    emitEvent: vi.fn(),
}));

vi.mock("@lib/common/logger.ts", () => ({
    LOG_LEVEL_NOTICE: 1,
    LOG_LEVEL_VERBOSE: 16,
}));

vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_P2P: "request-open-p2p",
    EVENT_REQUEST_OPEN_SETTING_WIZARD: "request-open-setting-wizard",
    EVENT_REQUEST_OPEN_SETTINGS: "request-open-settings",
    EVENT_REQUEST_RUN_DOCTOR: "request-run-doctor",
    EVENT_REQUEST_RUN_FIX_INCOMPLETE: "request-run-fix-incomplete",
    eventHub: {
        onEvent: mocks.onEvent,
        emitEvent: mocks.emitEvent,
    },
}));

vi.mock("@lib/common/i18n.ts", () => ({
    $msg: (key: string) => key,
}));

vi.mock("@lib/common/configForDoc.ts", () => ({
    RebuildOptions: {
        AutomaticAcceptable: 0,
        SkipEvenIfRequired: 1,
    },
    performDoctorConsultation: mocks.performDoctorConsultation,
}));

vi.mock("@lib/pouchdb/negotiation.ts", () => ({
    countCompromisedChunks: mocks.countCompromisedChunks,
}));

vi.mock("@/common/utils.ts", () => ({
    isValidPath: vi.fn(() => true),
}));

vi.mock("@lib/common/types.ts", () => ({
    isMetaEntry: vi.fn(() => true),
}));

vi.mock("@lib/common/utils.ts", () => ({
    isDeletedEntry: vi.fn(() => false),
    isDocContentSame: vi.fn(async () => true),
    isLoadedEntry: vi.fn(() => true),
    readAsBlob: vi.fn((doc: any) => ({ size: doc.size })),
}));

vi.mock("@/serviceFeatures/setupManager/index.ts", () => ({
    getSetupManager: () => ({
        startOnBoarding: mocks.startOnBoarding,
    }),
}));

import {
    hasCompromisedChunks,
    initialMigrationMessage,
    migrateDisableBulkSend,
    migrateUsingDoctor,
    runFirstInitialiseMigration,
} from "./migrationOperations.ts";

function createHost(overrides: any = {}) {
    const settings = {
        isConfigured: true,
        encrypt: false,
        sendChunksBulk: false,
        sendChunksBulkMaxSize: 100,
        ...overrides.settings,
    };
    return {
        services: {
            API: {
                isOnline: true,
            },
            UI: {
                confirm: {
                    askSelectStringDialogue: vi.fn(),
                },
            },
            appLifecycle: {
                performRestart: vi.fn(),
            },
            setting: {
                settings,
                applyExternalSettings: vi.fn(async (next: any) => {
                    Object.assign(settings, next);
                }),
            },
            database: {
                localDatabase: {
                    isReady: true,
                    localDatabase: {},
                },
            },
            keyValueDB: {
                kvDB: {
                    get: vi.fn(),
                    set: vi.fn(),
                },
            },
            path: {
                getPath: vi.fn((entry: any) => entry.path),
            },
            vault: {
                isTargetFile: vi.fn(async () => true),
            },
            replicator: {
                getActiveReplicator: vi.fn(),
            },
            ...overrides.services,
        },
        serviceModules: {
            rebuilder: {
                scheduleRebuild: vi.fn(),
                scheduleFetch: vi.fn(),
            },
            storageAccess: {
                readHiddenFileBinary: vi.fn(),
                getFileStub: vi.fn(),
            },
            fileHandler: {
                storeFileToDB: vi.fn(),
            },
            ...overrides.serviceModules,
        },
    } as any;
}

describe("migration operations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.performDoctorConsultation.mockResolvedValue({
            shouldRebuild: false,
            shouldRebuildLocal: false,
            isModified: false,
            settings: {},
        });
        mocks.startOnBoarding.mockResolvedValue(true);
    });

    it("schedules a remote rebuild and restarts when doctor requires it", async () => {
        const host = createHost();
        mocks.performDoctorConsultation.mockResolvedValue({
            shouldRebuild: true,
            shouldRebuildLocal: false,
            isModified: false,
            settings: {},
        });

        const result = await migrateUsingDoctor(host, false);

        expect(result).toBe(false);
        expect(host.serviceModules.rebuilder.scheduleRebuild).toHaveBeenCalledTimes(1);
        expect(host.services.appLifecycle.performRestart).toHaveBeenCalledTimes(1);
    });

    it("applies modified settings reported by doctor", async () => {
        const host = createHost();
        mocks.performDoctorConsultation.mockResolvedValue({
            shouldRebuild: false,
            shouldRebuildLocal: false,
            isModified: true,
            settings: { isConfigured: true, sendChunksBulk: false },
        });

        await expect(migrateUsingDoctor(host, true)).resolves.toBe(true);

        expect(host.services.setting.applyExternalSettings).toHaveBeenCalledWith(
            { isConfigured: true, sendChunksBulk: false },
            true
        );
        expect(host.serviceModules.rebuilder.scheduleRebuild).not.toHaveBeenCalled();
        expect(host.services.appLifecycle.performRestart).not.toHaveBeenCalled();
    });

    it("disables bulk chunk sending when the migration flag is active", async () => {
        const host = createHost({ settings: { sendChunksBulk: true, sendChunksBulkMaxSize: 100 } });
        const log = vi.fn();

        await migrateDisableBulkSend(host, log);

        expect(log).toHaveBeenCalledWith(expect.any(String), 1);
        expect(host.services.setting.applyExternalSettings).toHaveBeenCalledWith(
            expect.objectContaining({ sendChunksBulk: false, sendChunksBulkMaxSize: 1 }),
            true
        );
    });

    it("skips compromised chunk checks when encryption is disabled", async () => {
        const host = createHost({ settings: { encrypt: false } });

        await expect(hasCompromisedChunks(host, vi.fn())).resolves.toBe(true);

        expect(mocks.countCompromisedChunks).not.toHaveBeenCalled();
    });

    it("stops first initialisation when the local database is not ready", async () => {
        const host = createHost({
            services: {
                database: {
                    localDatabase: {
                        isReady: false,
                        localDatabase: {},
                    },
                },
            },
        });
        const log = vi.fn();

        await expect(runFirstInitialiseMigration(host, log)).resolves.toBe(false);

        expect(log).toHaveBeenCalledWith(expect.any(String), 1);
        expect(mocks.performDoctorConsultation).not.toHaveBeenCalled();
    });

    it("starts onboarding for an unconfigured vault", async () => {
        const host = createHost({ settings: { isConfigured: false } });

        await expect(runFirstInitialiseMigration(host, vi.fn())).resolves.toBe(true);

        expect(mocks.startOnBoarding).toHaveBeenCalledTimes(1);
        expect(mocks.performDoctorConsultation).toHaveBeenCalledTimes(1);
    });

    it("delegates the initial migration message to setup manager", async () => {
        await expect(initialMigrationMessage()).resolves.toBe(true);

        expect(mocks.startOnBoarding).toHaveBeenCalledTimes(1);
    });
});
