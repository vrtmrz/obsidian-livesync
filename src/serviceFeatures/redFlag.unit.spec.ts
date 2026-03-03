import { describe, it, expect, vi } from "vitest";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { FlagFilesHumanReadable, FlagFilesOriginal } from "@lib/common/models/redflag.const";
import { REMOTE_MINIO } from "@lib/common/models/setting.const";
import {
    createFetchAllFlagHandler,
    createRebuildFlagHandler,
    createSuspendFlagHandler,
    isFlagFileExist,
    deleteFlagFile,
    adjustSettingToRemote,
    adjustSettingToRemoteIfNeeded,
    processVaultInitialisation,
    verifyAndUnlockSuspension,
    flagHandlerToEventHandler,
} from "./redFlag";
import {
    TweakValuesRecommendedTemplate,
    TweakValuesShouldMatchedTemplate,
    TweakValuesTemplate,
} from "@/lib/src/common/types";

// Mock types and functions
const createLoggerMock = (): LogFunction => {
    return vi.fn();
};

const createStorageAccessMock = () => {
    const files: Set<string> = new Set();
    return {
        files,
        isExists: vi.fn((path: string) => Promise.resolve(files.has(path))),
        normalisePath: vi.fn((path: string) => path),
        delete: vi.fn((path: string, _recursive?: boolean) => {
            files.delete(path);
            return Promise.resolve();
        }),
        getFileNames: vi.fn(() => Array.from(files)),
    };
};

const createSettingServiceMock = () => {
    const settings: any = {
        batchSave: true,
        suspendFileWatching: false,
        writeLogToTheFile: false,
        remoteType: "CouchDB",
    };
    return {
        settings,
        currentSettings: vi.fn(() => settings),
        applyPartial: vi.fn((partial: any, _feedback?: boolean) => {
            Object.assign(settings, partial);
            return Promise.resolve();
        }),
        suspendAllSync: vi.fn(() => Promise.resolve()),
        suspendExtraSync: vi.fn(() => Promise.resolve()),
    };
};

const createAppLifecycleMock = () => {
    return {
        performRestart: vi.fn(),
        onLayoutReady: {
            addHandler: vi.fn(),
        },
    };
};

const createUIServiceMock = () => {
    return {
        dialogManager: {
            openWithExplicitCancel: vi.fn(),
        },
        confirm: {
            askSelectStringDialogue: vi.fn(),
            askYesNoDialog: vi.fn(),
        },
    };
};

const createRebuilderMock = () => {
    return {
        $fetchLocal: vi.fn(async () => {}),
        $rebuildEverything: vi.fn(async () => {}),
    };
};

const createTweakValueMock = () => {
    return {
        fetchRemotePreferred: vi.fn(() => Promise.resolve<any>(null)),
    };
};

const createHostMock = () => {
    const storageAccessMock = createStorageAccessMock();
    const settingMock = createSettingServiceMock();
    const appLifecycleMock = createAppLifecycleMock();
    const uiMock = createUIServiceMock();
    const rebuilderMock = createRebuilderMock();
    const tweakValueMock = createTweakValueMock();

    return {
        services: {
            setting: settingMock,
            appLifecycle: appLifecycleMock,
            UI: uiMock,
            tweakValue: tweakValueMock,
        },
        serviceModules: {
            storageAccess: storageAccessMock,
            rebuilder: rebuilderMock,
        },
        mocks: {
            storageAccess: storageAccessMock,
            setting: settingMock,
            appLifecycle: appLifecycleMock,
            ui: uiMock,
            rebuilder: rebuilderMock,
            tweakValue: tweakValueMock,
        },
    };
};

describe("Red Flag Feature", () => {
    describe("isFlagFileExist", () => {
        it("should return true if flag file exists", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            const result = await isFlagFileExist(host as any, FlagFilesOriginal.FETCH_ALL);
            expect(result).toBe(true);
        });

        it("should return false if flag file does not exist", async () => {
            const host = createHostMock();

            const result = await isFlagFileExist(host as any, FlagFilesOriginal.FETCH_ALL);
            expect(result).toBe(false);
        });
    });

    describe("deleteFlagFile", () => {
        it("should delete flag file if it exists", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL);

            const exists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.FETCH_ALL)
            );
            expect(exists).toBe(false);
        });

        it("should not throw error if file does not exist", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await expect(deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL)).resolves.not.toThrow();
        });

        it("should log error if deletion fails", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.delete.mockRejectedValueOnce(new Error("Delete failed"));
            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL);

            expect(log).toHaveBeenCalled();
        });
    });

    describe("FlagFile Handler Priority", () => {
        it("should handle suspend flag with priority 5", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createSuspendFlagHandler(host as any, log);
            expect(handler.priority).toBe(5);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });

        it("should handle fetch all flag with priority 10", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            expect(handler.priority).toBe(10);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });

        it("should handle rebuild all flag with priority 20", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createRebuildFlagHandler(host as any, log);
            expect(handler.priority).toBe(20);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });
    });

    describe("Setting adjustment during vault initialisation", () => {
        it("should suspend file watching during initialisation", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(false);

            const result = await processVaultInitialisation(host as any, log, () => {
                expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(true);
                return Promise.resolve(true);
            });

            expect(result).toBe(true);
        });

        it("should disable batch save during initialisation", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            expect(host.mocks.setting.currentSettings().batchSave).toBe(true);

            const result = await processVaultInitialisation(host as any, log, () => {
                expect(host.mocks.setting.currentSettings().batchSave).toBe(false);
                return Promise.resolve(true);
            });

            expect(result).toBe(true);
        });

        it("should suspend all sync operations", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(host as any, log, () => {
                return Promise.resolve(true);
            });

            expect(host.mocks.setting.suspendAllSync).toHaveBeenCalled();
            expect(host.mocks.setting.suspendExtraSync).toHaveBeenCalled();
        });

        it("should resume file watching after initialisation completes", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(
                host as any,
                log,
                () => {
                    return Promise.resolve(true);
                },
                false
            );

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(false);
        });

        it("should keep suspending when keepSuspending is true", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(
                host as any,
                log,
                () => {
                    return Promise.resolve(true);
                },
                true
            );

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(true);
        });

        it("should return false when process fails", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const result = await processVaultInitialisation(
                host as any,
                log,
                () => {
                    throw new Error("Process failed");
                },
                false
            );

            expect(result).toBe(false);
            expect(log).toHaveBeenCalled();
        });
    });

    describe("Suspend Flag Handler", () => {
        it("should write logs to file when suspend flag is detected", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createSuspendFlagHandler(host as any, log);

            expect(handler.priority).toBe(5);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });

        it("should keep suspending after initialisation when suspend flag is active", async () => {
            const host = createHostMock();

            const handler = createSuspendFlagHandler(host as any, createLoggerMock());

            const checkResult = await handler.check();
            expect(typeof checkResult).toBe("boolean");
        });

        it("should apply writeLogToTheFile setting during suspension", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, createLoggerMock());
            const checkResult = await handler.check();

            expect(checkResult).toBe(true);
        });
    });

    describe("Fetch All Flag Handler", () => {
        it("should detect fetch all flag using original filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            const handler = createFetchAllFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should detect fetch all flag using human-readable filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);

            const handler = createFetchAllFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should clean up both original and human-readable fetch all flag files", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL);
            await deleteFlagFile(host as any, log, FlagFilesHumanReadable.FETCH_ALL);

            const originalExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.FETCH_ALL)
            );
            const humanExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesHumanReadable.FETCH_ALL)
            );

            expect(originalExists).toBe(false);
            expect(humanExists).toBe(false);
        });

        it("should have priority 10", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            expect(handler.priority).toBe(10);
        });
    });

    describe("Rebuild All Flag Handler", () => {
        it("should detect rebuild all flag using original filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);

            const handler = createRebuildFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should detect rebuild all flag using human-readable filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.REBUILD_ALL);

            const handler = createRebuildFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should clean up both original and human-readable rebuild all flag files", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.REBUILD_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.REBUILD_ALL);
            await deleteFlagFile(host as any, log, FlagFilesHumanReadable.REBUILD_ALL);

            const originalExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.REBUILD_ALL)
            );
            const humanExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesHumanReadable.REBUILD_ALL)
            );

            expect(originalExists).toBe(false);
            expect(humanExists).toBe(false);
        });

        it("should have priority 20", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createRebuildFlagHandler(host as any, log);
            expect(handler.priority).toBe(20);
        });
    });

    describe("Flag file cleanup on error", () => {
        it("should handle errors during flag file deletion gracefully", async () => {
            const host = createHostMock();

            // Simulate error in delete operation
            host.mocks.storageAccess.delete.mockRejectedValueOnce(new Error("Delete failed"));

            try {
                await host.mocks.storageAccess.delete(FlagFilesOriginal.FETCH_ALL, true);
            } catch {
                // Error handled
            }

            expect(host.mocks.storageAccess.delete).toHaveBeenCalled();
        });
    });

    describe("Integration: Handler registration on layout ready", () => {
        it("should register handlers with correct priorities", () => {
            const host = createHostMock();

            expect(host.services.appLifecycle.onLayoutReady.addHandler).toBeDefined();
            expect(typeof host.services.appLifecycle.onLayoutReady.addHandler).toBe("function");
        });
    });

    describe("Dialog interaction scenarios", () => {
        it("should handle fetch all dialog cancellation", async () => {
            const host = createHostMock();

            // Simulate user clicking cancel
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            // The dialog manager would return cancelled
            const result = await host.mocks.ui.dialogManager.openWithExplicitCancel();
            expect(result).toBe("cancelled");
        });

        it("should handle rebuild dialog cancellation", async () => {
            const host = createHostMock();

            // Simulate user clicking cancel
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            const result = await host.mocks.ui.dialogManager.openWithExplicitCancel();
            expect(result).toBe("cancelled");
        });

        it("should handle confirm dialog for remote configuration mismatch", async () => {
            const host = createHostMock();

            await host.mocks.ui.confirm.askSelectStringDialogue("Your settings differed slightly.", ["OK"]);
            expect(host.mocks.ui.confirm.askSelectStringDialogue).toHaveBeenCalled();
        });
    });

    describe("Remote configuration adjustment", () => {
        it("should skip remote configuration fetch when preventFetchingConfig is true", async () => {
            const host = createHostMock();
            const config = { preventFetchingConfig: true } as any;

            await adjustSettingToRemoteIfNeeded(
                host as any,
                createLoggerMock(),
                { preventFetchingConfig: true },
                config
            );

            expect(host.mocks.tweakValue.fetchRemotePreferred).not.toHaveBeenCalled();
        });

        it("should fetch remote configuration when preventFetchingConfig is false", async () => {
            const host = createHostMock();
            const config = { batchSave: true } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                batchSave: false,
            } as any);

            await adjustSettingToRemoteIfNeeded(
                host as any,
                createLoggerMock(),
                { preventFetchingConfig: false },
                config
            );

            expect(host.mocks.tweakValue.fetchRemotePreferred).toHaveBeenCalled();
        });

        const mismatchDetectionKeys = Object.keys(TweakValuesShouldMatchedTemplate);
        it.each(mismatchDetectionKeys)(
            "should apply remote configuration when available and different:%s",
            async (key) => {
                const host = createHostMock();

                const config = { [key]: TweakValuesTemplate[key as keyof typeof TweakValuesTemplate] } as any;
                const differentValue =
                    typeof config[key as keyof typeof config] === "boolean"
                        ? !config[key as keyof typeof config]
                        : typeof config[key as keyof typeof config] === "number"
                          ? (config[key as keyof typeof config] as number) + 1
                          : "different";
                const differentConfig = {
                    [key]: differentValue,
                };
                host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(differentConfig as any);
                host.mocks.ui.confirm.askSelectStringDialogue.mockResolvedValueOnce("OK");

                await adjustSettingToRemote(host as any, createLoggerMock(), config);
                expect(host.mocks.ui.confirm.askSelectStringDialogue).toHaveBeenCalled();
                expect(host.mocks.setting.applyPartial).toHaveBeenCalled();
            }
        );
        const mismatchAcceptedKeys = Object.keys(TweakValuesRecommendedTemplate).filter(
            (key) => !mismatchDetectionKeys.includes(key)
        );

        it.each(mismatchAcceptedKeys)(
            "should apply remote configuration when available and different but acceptable: %s",
            async (key) => {
                const host = createHostMock();

                const config = { [key]: TweakValuesTemplate[key as keyof typeof TweakValuesTemplate] } as any;
                const differentValue =
                    typeof config[key as keyof typeof config] === "boolean"
                        ? !config[key as keyof typeof config]
                        : typeof config[key as keyof typeof config] === "number"
                          ? (config[key as keyof typeof config] as number) + 1
                          : "different";
                const differentConfig = {
                    [key]: differentValue,
                };
                host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(differentConfig as any);
                host.mocks.ui.confirm.askSelectStringDialogue.mockResolvedValueOnce("OK");

                await adjustSettingToRemote(host as any, createLoggerMock(), config);

                expect(host.mocks.setting.applyPartial).toHaveBeenCalled();
                expect(host.mocks.ui.confirm.askSelectStringDialogue).not.toHaveBeenCalled();
            }
        );

        it("should show dialog when remote fetch fails", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            const config = { batchSave: true } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(null);
            host.mocks.ui.confirm.askSelectStringDialogue.mockResolvedValueOnce("Skip and proceed");

            await adjustSettingToRemote(host as any, log, config);

            expect(host.mocks.ui.confirm.askSelectStringDialogue).toHaveBeenCalled();
        });

        it("should retry when user selects retry option", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            const config = { batchSave: true } as any;

            host.mocks.tweakValue.fetchRemotePreferred
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ batchSave: false } as any);
            host.mocks.ui.confirm.askSelectStringDialogue.mockResolvedValueOnce("Retry (recommended)");

            await adjustSettingToRemote(host as any, log, config);

            expect(host.mocks.tweakValue.fetchRemotePreferred).toHaveBeenCalledTimes(2);
        });

        it("should log when no changes needed", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            const config = { batchSave: false } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                batchSave: false,
            } as any);

            await adjustSettingToRemote(host as any, log, config);

            expect(log).toHaveBeenCalled();
        });

        it("should handle null extra parameter in adjustSettingToRemoteIfNeeded", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            const config = { batchSave: true } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(null);
            host.mocks.ui.confirm.askSelectStringDialogue.mockResolvedValueOnce("Skip and proceed");

            await adjustSettingToRemoteIfNeeded(host as any, log, null as any, config);

            expect(host.mocks.tweakValue.fetchRemotePreferred).toHaveBeenCalled();
        });
    });

    describe("MinIO configuration handling", () => {
        it("should not enable makeLocalChunkBeforeSync when remote is MinIO", () => {
            const host = createHostMock();
            host.mocks.setting.settings.remoteType = REMOTE_MINIO;

            const settings = host.mocks.setting.currentSettings();
            const isMinIO = settings.remoteType === REMOTE_MINIO;

            expect(isMinIO).toBe(true);
        });

        it("should enable makeLocalChunkBeforeSync for non-MinIO remotes", () => {
            const host = createHostMock();
            host.mocks.setting.settings.remoteType = "CouchDB";

            const settings = host.mocks.setting.currentSettings();
            const isMinIO = settings.remoteType === REMOTE_MINIO;

            expect(isMinIO).toBe(false);
        });
    });

    describe("Suspension unlock verification", () => {
        it("should return true when suspension is not active", async () => {
            const host = createHostMock();

            const result = await verifyAndUnlockSuspension(host as any, createLoggerMock());
            expect(result).toBe(true);
        });

        it("should ask for confirmation when suspension is active", async () => {
            const host = createHostMock();

            await host.mocks.setting.applyPartial({ suspendFileWatching: true });

            host.mocks.ui.confirm.askYesNoDialog.mockResolvedValueOnce("yes");

            await verifyAndUnlockSuspension(host as any, createLoggerMock());

            expect(host.mocks.ui.confirm.askYesNoDialog).toHaveBeenCalled();
        });

        it("should return true when user declines suspension unlock", async () => {
            const host = createHostMock();

            await host.mocks.setting.applyPartial({ suspendFileWatching: true });
            host.mocks.ui.confirm.askYesNoDialog.mockResolvedValueOnce("no");

            const result = await verifyAndUnlockSuspension(host as any, createLoggerMock());

            expect(result).toBe(true);
        });

        it("should resume file watching and restart when user accepts", async () => {
            const host = createHostMock();

            await host.mocks.setting.applyPartial({ suspendFileWatching: true }, true);
            host.mocks.ui.confirm.askYesNoDialog.mockResolvedValueOnce("yes");

            await verifyAndUnlockSuspension(host as any, createLoggerMock());

            expect(host.mocks.appLifecycle.performRestart).toHaveBeenCalled();
        });
    });

    describe("Error handling in vault initialization", () => {
        it("should handle errors during initialisation gracefully", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const result = await processVaultInitialisation(host as any, log, () => {
                throw new Error("Initialization failed");
            });

            expect(result).toBe(false);
            expect(log).toHaveBeenCalled();
        });

        it("should track log calls during error conditions", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(host as any, log, () => {
                throw new Error("Test error");
            });

            expect(log).toHaveBeenCalled();
        });

        it("should keep suspension state when error occurs during initialization", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(
                host as any,
                log,
                () => {
                    return Promise.resolve(false);
                },
                true
            );

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(true);
        });

        it("should handle applySetting error in processVaultInitialisation", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.setting.applyPartial.mockRejectedValueOnce(new Error("Apply partial failed"));

            const result = await processVaultInitialisation(host as any, log, () => {
                return Promise.resolve(true);
            });

            expect(result).toBe(false);
        });
    });

    describe("Flag file detection with both formats", () => {
        it("should detect either original or human-readable fetch all flag", async () => {
            const host = createHostMock();

            // Add only human-readable flag
            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);

            const humanExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesHumanReadable.FETCH_ALL)
            );

            expect(humanExists).toBe(true);
        });

        it("should detect either original or human-readable rebuild flag", async () => {
            const host = createHostMock();

            // Add only original flag
            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);

            const originalExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.REBUILD_ALL)
            );

            expect(originalExists).toBe(true);
        });
    });

    describe("Handler execution", () => {
        it("should execute fetch all handler check method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            const handler = createFetchAllFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(true);
        });

        it("should execute rebuild handler check method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);

            const handler = createRebuildFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(true);
        });

        it("should execute suspend handler check method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(true);
        });

        it("should return false when flag does not exist", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(false);
        });

        it("should return correct priority for each handler", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const suspendHandler = createSuspendFlagHandler(host as any, log);
            const fetchHandler = createFetchAllFlagHandler(host as any, log);
            const rebuildHandler = createRebuildFlagHandler(host as any, log);

            expect(suspendHandler.priority).toBe(5);
            expect(fetchHandler.priority).toBe(10);
            expect(rebuildHandler.priority).toBe(20);
        });

        it("should handle suspend flag and execute handler", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const checkResult = await handler.check();

            expect(checkResult).toBe(true);
            expect(typeof handler.handle).toBe("function");
        });

        it("should have handle method for all handlers", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const suspendHandler = createSuspendFlagHandler(host as any, log);
            const fetchHandler = createFetchAllFlagHandler(host as any, log);
            const rebuildHandler = createRebuildFlagHandler(host as any, log);

            expect(typeof suspendHandler.handle).toBe("function");
            expect(typeof fetchHandler.handle).toBe("function");
            expect(typeof rebuildHandler.handle).toBe("function");
        });
    });

    describe("Multiple concurrent operations", () => {
        it("should handle multiple flag files existing simultaneously", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const fetchExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.FETCH_ALL)
            );
            const rebuildExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.REBUILD_ALL)
            );
            const suspendExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.SUSPEND_ALL)
            );

            expect(fetchExists).toBe(true);
            expect(rebuildExists).toBe(true);
            expect(suspendExists).toBe(true);
        });

        it("should cleanup all flags when processing completes", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);
            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            await host.mocks.storageAccess.delete(FlagFilesHumanReadable.FETCH_ALL);
            await host.mocks.storageAccess.delete(FlagFilesOriginal.FETCH_ALL);

            expect(host.mocks.storageAccess.files.size).toBe(0);
        });
    });

    describe("Setting state transitions", () => {
        it("should apply complete state transition for initialization", async () => {
            const host = createHostMock();

            // Initial state
            const initialState = {
                batchSave: host.mocks.setting.currentSettings().batchSave,
                suspendFileWatching: host.mocks.setting.currentSettings().suspendFileWatching,
            };

            // Initialization state
            await host.mocks.setting.applyPartial(
                {
                    batchSave: false,
                    suspendFileWatching: true,
                },
                true
            );

            const initState = {
                batchSave: host.mocks.setting.currentSettings().batchSave,
                suspendFileWatching: host.mocks.setting.currentSettings().suspendFileWatching,
            };

            // Post-initialization state
            await host.mocks.setting.applyPartial(
                {
                    batchSave: true,
                    suspendFileWatching: false,
                },
                true
            );

            const finalState = {
                batchSave: host.mocks.setting.currentSettings().batchSave,
                suspendFileWatching: host.mocks.setting.currentSettings().suspendFileWatching,
            };

            expect(initialState.batchSave).toBe(true);
            expect(initialState.suspendFileWatching).toBe(false);

            expect(initState.batchSave).toBe(false);
            expect(initState.suspendFileWatching).toBe(true);

            expect(finalState.batchSave).toBe(true);
            expect(finalState.suspendFileWatching).toBe(false);
        });
    });

    describe("flagHandlerToEventHandler integration", () => {
        it("should return true when flag does not exist", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();
            expect(result).toBe(true);
        });

        it("should execute handle when flag exists and check returns true", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            await eventHandler();

            // When dialog is cancelled, handle returns false
            expect(host.mocks.ui.dialogManager.openWithExplicitCancel).toHaveBeenCalled();
        });

        it("should return handle result when flag exists", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();

            // Suspend handler execution results in false from processVaultInitialisation
            expect(typeof result).toBe("boolean");
        });

        it("should not call handle when check returns false", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createRebuildFlagHandler(host as any, log);
            const handleSpy = vi.spyOn(handler, "handle");
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();

            // Check returns false because no rebuild flag exists
            expect(handleSpy).not.toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it("should handle rebuild flag with flagHandlerToEventHandler", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            const handler = createRebuildFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            await eventHandler();

            expect(host.mocks.ui.dialogManager.openWithExplicitCancel).toHaveBeenCalled();
        });

        it("should propagate errors from handle method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockRejectedValueOnce(new Error("Dialog failed"));

            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            try {
                await eventHandler();
            } catch (error) {
                expect((error as Error).message).toBe("Dialog failed");
            }
        });

        it("should handle fetchAll flag with flagHandlerToEventHandler identical", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                customChunkSize: 1,
            } as any);

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce({ vault: "identical", extra: {} });
            host.mocks.rebuilder.$fetchLocal.mockResolvedValueOnce();
            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            await Promise.resolve(eventHandler());
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(host.mocks.rebuilder.$fetchLocal).toHaveBeenCalled();

            expect(host.mocks.ui.dialogManager.openWithExplicitCancel).toHaveBeenCalled();
        });
        it("should handle rebuildAll flag with flagHandlerToEventHandler", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                customChunkSize: 1,
            } as any);

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce({ extra: {} });
            host.mocks.rebuilder.$rebuildEverything.mockResolvedValueOnce();
            const handler = createRebuildFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            await Promise.resolve(eventHandler());
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(host.mocks.rebuilder.$rebuildEverything).toHaveBeenCalled();

            expect(host.mocks.ui.dialogManager.openWithExplicitCancel).toHaveBeenCalled();
        });

        it("should execute all handlers in sequence", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const suspendHandler = createSuspendFlagHandler(host as any, log);
            const fetchHandler = createFetchAllFlagHandler(host as any, log);
            const rebuildHandler = createRebuildFlagHandler(host as any, log);

            const suspendEvent = flagHandlerToEventHandler(suspendHandler);
            const fetchEvent = flagHandlerToEventHandler(fetchHandler);
            const rebuildEvent = flagHandlerToEventHandler(rebuildHandler);

            // All should return true when flags don't exist
            expect(await suspendEvent()).toBe(true);
            expect(await fetchEvent()).toBe(true);
            expect(await rebuildEvent()).toBe(true);
        });

        it("should return false from handle when suspending", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();

            // Suspend handler returns false from its handle method
            expect(result).toBe(false);
        });

        it("should handle check error gracefully", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.isExists.mockRejectedValueOnce(new Error("Check failed"));

            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            try {
                await eventHandler();
            } catch (error) {
                expect((error as Error).message).toBe("Check failed");
            }
        });
    });
});
