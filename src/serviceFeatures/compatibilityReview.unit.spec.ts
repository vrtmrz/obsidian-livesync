import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    COMPATIBILITY_PAUSE_SETTING_MESSAGE,
    DATABASE_COMPATIBILITY_VERSION_KEY,
    legacyDatabaseCompatibilityVersionKey,
} from "@/common/databaseCompatibility.ts";
import {
    CompatibilityReviewController,
    type CompatibilityReviewUi,
    useCompatibilityReview,
} from "./compatibilityReview.ts";

function migrationState(overrides: Record<string, unknown> = {}) {
    return {
        sourceVersion: 2,
        targetVersion: 2,
        isNewVault: false,
        isFromFutureSchema: false,
        changed: false,
        requiresSyncReview: false,
        reviewReasons: [],
        ...overrides,
    };
}

function createFixture(
    options: {
        marker?: string | null;
        legacyMarker?: string | null;
        versionUpFlash?: string;
        isConfigured?: boolean;
        migration?: Record<string, unknown>;
    } = {}
) {
    const local = new Map<string, string>();
    const deviceValues = new Map<string, string>();
    if (options.marker !== undefined && options.marker !== null) {
        local.set(DATABASE_COMPATIBILITY_VERSION_KEY, options.marker);
    }
    const legacyKey = legacyDatabaseCompatibilityVersionKey("Test Vault");
    if (options.legacyMarker !== undefined && options.legacyMarker !== null) {
        deviceValues.set(legacyKey, options.legacyMarker);
    }
    const config = {
        getValue: vi.fn(async (key: string, defaultValue = "") => local.get(key) ?? defaultValue),
        setValue: vi.fn(async (key: string, value: string) => {
            local.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
            local.delete(key);
        }),
    };
    const deviceValueStore = {
        getValue: vi.fn(async (key: string, defaultValue = "") => deviceValues.get(key) ?? defaultValue),
        setValue: vi.fn(async (key: string, value: string) => {
            deviceValues.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
            deviceValues.delete(key);
        }),
    };
    const settings = {
        versionUpFlash: options.versionUpFlash ?? "",
        isConfigured: options.isConfigured ?? true,
    };
    const saveSettingData = vi.fn().mockResolvedValue(undefined);
    const applySettings = vi.fn().mockResolvedValue(true);
    const setting = {
        currentSettings: () => settings,
        getSettingsMigrationState: () => migrationState(options.migration),
        deviceValues: deviceValueStore,
        saveSettingData,
    };
    const core = {
        services: {
            setting,
            config,
            vault: { getVaultName: () => "Test Vault" },
            control: { applySettings },
        },
    } as never;
    const ui: CompatibilityReviewUi = {
        showSummary: vi.fn().mockResolvedValue("keep-paused"),
        showDetails: vi.fn().mockResolvedValue(false),
        showReminder: vi.fn(),
        clearReminder: vi.fn(),
    };
    const controller = new CompatibilityReviewController(core, ui, 12);
    return {
        controller,
        ui,
        local,
        deviceValues,
        config,
        deviceValueStore,
        legacyKey,
        settings,
        saveSettingData,
        applySettings,
    };
}

describe("compatibility review controller", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("initialises the acknowledged version for a new Vault without showing a pause", async () => {
        const fixture = createFixture({ marker: null, isConfigured: false, migration: { isNewVault: true } });

        expect(fixture.controller.initialised).toBe(false);

        await expect(fixture.controller.initialise()).resolves.toBe(true);

        expect(fixture.controller.initialised).toBe(true);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.saveSettingData).not.toHaveBeenCalled();
    });

    it("defers a missing database marker while the Vault remains unconfigured", async () => {
        const fixture = createFixture({ marker: null, isConfigured: false });

        await expect(fixture.controller.initialise()).resolves.toBe(true);

        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.settings.versionUpFlash).toBe("");
        expect(fixture.local.has(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe(false);
        expect(fixture.saveSettingData).not.toHaveBeenCalled();

        fixture.settings.isConfigured = true;
        await expect(fixture.controller.initialise()).resolves.toBe(true);

        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.settings.versionUpFlash).toBe("");
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.saveSettingData).not.toHaveBeenCalled();
    });

    it("starts a configured Vault with no device marker without a review or settings changes", async () => {
        const fixture = createFixture({ marker: null });
        const previousSettings = { ...fixture.settings };

        await fixture.controller.initialise();
        await fixture.controller.openReview();

        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.settings).toEqual(previousSettings);
        expect(fixture.saveSettingData).not.toHaveBeenCalled();
        expect(fixture.ui.showSummary).not.toHaveBeenCalled();
        expect(fixture.ui.showReminder).not.toHaveBeenCalled();
    });

    it("keeps an already persisted review when the device marker is absent", async () => {
        const fixture = createFixture({ marker: null, versionUpFlash: COMPATIBILITY_PAUSE_SETTING_MESSAGE });

        await fixture.controller.initialise();
        await fixture.controller.openReview();

        expect(fixture.settings.versionUpFlash).toBe(COMPATIBILITY_PAUSE_SETTING_MESSAGE);
        expect(fixture.controller.pendingPause?.reasons).toEqual([
            {
                source: "legacy-review",
                message: COMPATIBILITY_PAUSE_SETTING_MESSAGE,
                resumable: true,
            },
        ]);
        expect(fixture.local.has(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe(false);
        expect(fixture.ui.showReminder).toHaveBeenCalledOnce();
    });

    it("preserves preferences and advances the marker only after an upgrade review is resumed", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");

        await fixture.controller.initialise();

        expect(fixture.settings.versionUpFlash).toBe(COMPATIBILITY_PAUSE_SETTING_MESSAGE);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.saveSettingData).toHaveBeenCalledTimes(1);

        await fixture.controller.openReview();

        expect(fixture.settings.versionUpFlash).toBe("");
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.saveSettingData).toHaveBeenCalledTimes(2);
        expect(fixture.applySettings).toHaveBeenCalledOnce();
        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.ui.clearReminder).toHaveBeenCalled();
    });

    it("does not allow a downgrade pause to be resumed", async () => {
        const fixture = createFixture({ marker: "13" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");

        await fixture.controller.initialise();
        await fixture.controller.openReview();

        expect(fixture.controller.pendingPause?.resumable).toBe(false);
        expect(fixture.settings.versionUpFlash).toBe(COMPATIBILITY_PAUSE_SETTING_MESSAGE);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("13");
        expect(fixture.applySettings).not.toHaveBeenCalled();
        expect(fixture.ui.showReminder).toHaveBeenCalledOnce();
    });

    it("returns from details to the reason dialogue and leaves a persistent reminder", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValueOnce("details").mockResolvedValueOnce("keep-paused");
        vi.mocked(fixture.ui.showDetails).mockResolvedValue("back");

        await fixture.controller.initialise();
        await fixture.controller.openReview();

        expect(fixture.ui.showSummary).toHaveBeenCalledTimes(2);
        expect(fixture.ui.showDetails).toHaveBeenCalledOnce();
        expect(fixture.ui.showReminder).toHaveBeenCalledOnce();
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
    });

    it("migrates the old Vault-scoped marker to Commonlib device-local storage", async () => {
        const fixture = createFixture({ legacyMarker: "11" });

        await fixture.controller.initialise();

        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.deviceValues.has(fixture.legacyKey)).toBe(false);
        expect(fixture.controller.pendingPause).toBeDefined();
    });

    it("saves the scoped marker before deleting the legacy device value", async () => {
        const fixture = createFixture({ legacyMarker: "11" });
        let finishSave!: () => void;
        const saving = new Promise<void>((resolve) => {
            finishSave = resolve;
        });
        fixture.config.setValue.mockImplementation(async (key, value) => {
            await saving;
            fixture.local.set(key, value);
        });

        const initialising = fixture.controller.initialise();
        await Promise.resolve();
        await Promise.resolve();

        expect(fixture.deviceValues.get(fixture.legacyKey)).toBe("11");
        expect(fixture.deviceValueStore.delete).not.toHaveBeenCalled();
        expect(fixture.controller.initialised).toBe(false);

        finishSave();
        await initialising;

        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.deviceValues.has(fixture.legacyKey)).toBe(false);
        expect(fixture.controller.initialised).toBe(true);
    });

    it("does not treat a failed marker read as an absent value", async () => {
        const fixture = createFixture({ legacyMarker: "11" });
        fixture.config.getValue.mockRejectedValueOnce(new Error("marker read failed"));

        await expect(fixture.controller.initialise()).rejects.toThrow("marker read failed");

        expect(fixture.deviceValueStore.getValue).not.toHaveBeenCalled();
        expect(fixture.deviceValues.get(fixture.legacyKey)).toBe("11");
        expect(fixture.controller.initialised).toBe(false);
    });

    it("keeps the compatibility pause blocked until its async marker write succeeds", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");
        await fixture.controller.initialise();
        let finishSave!: () => void;
        const saving = new Promise<void>((resolve) => {
            finishSave = resolve;
        });
        fixture.config.setValue.mockImplementation(async (key, value) => {
            await saving;
            fixture.local.set(key, value);
        });

        const reviewing = fixture.controller.openReview();
        await Promise.resolve();
        await Promise.resolve();

        expect(fixture.controller.pendingPause).toBeDefined();
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.applySettings).not.toHaveBeenCalled();

        finishSave();
        await reviewing;

        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.applySettings).toHaveBeenCalledOnce();
    });

    it("keeps a storage-failed acknowledgement blocked and retryable", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");
        await fixture.controller.initialise();
        fixture.config.setValue.mockRejectedValueOnce(new Error("marker write failed"));

        await expect(fixture.controller.openReview()).rejects.toThrow("marker write failed");

        expect(fixture.controller.pendingPause).toBeDefined();
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.applySettings).not.toHaveBeenCalled();

        await fixture.controller.openReview();

        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.applySettings).toHaveBeenCalledOnce();
    });

    it("restores the runtime gate if persisting an acknowledgement fails", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");
        await fixture.controller.initialise();
        fixture.saveSettingData.mockRejectedValueOnce(new Error("save failed"));

        await expect(fixture.controller.openReview()).rejects.toThrow("save failed");

        expect(fixture.settings.versionUpFlash).toBe(COMPATIBILITY_PAUSE_SETTING_MESSAGE);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.applySettings).not.toHaveBeenCalled();
    });

    it("does not open a delayed review after the controller has been disposed", async () => {
        const fixture = createFixture({ marker: "11" });
        await fixture.controller.initialise();

        fixture.controller.dispose();
        await fixture.controller.openReview();

        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.ui.showSummary).not.toHaveBeenCalled();
        expect(fixture.ui.clearReminder).toHaveBeenCalledOnce();
    });

    it("runs the review after the ordered red flag recovery handlers", () => {
        const onSettingLoaded = { addHandler: vi.fn() };
        const onLayoutReady = { addHandler: vi.fn() };
        const onUnload = { addHandler: vi.fn() };
        const core = {
            services: {
                appLifecycle: { onSettingLoaded, onLayoutReady, onUnload },
                API: { addCommand: vi.fn() },
            },
        } as never;
        const ui: CompatibilityReviewUi = {
            showSummary: vi.fn(),
            showDetails: vi.fn(),
            showReminder: vi.fn(),
            clearReminder: vi.fn(),
        };

        useCompatibilityReview(core, ui);

        expect(onLayoutReady.addHandler).toHaveBeenCalledWith(expect.any(Function), 30);
    });
});
