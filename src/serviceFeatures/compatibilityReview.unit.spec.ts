import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    COMPATIBILITY_PAUSE_SETTING_MESSAGE,
    DATABASE_COMPATIBILITY_VERSION_KEY,
    legacyDatabaseCompatibilityVersionKey,
} from "@/common/databaseCompatibility.ts";
import { CompatibilityReviewController, type CompatibilityReviewUi } from "./compatibilityReview.ts";

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
        migration?: Record<string, unknown>;
    } = {}
) {
    const local = new Map<string, string>();
    if (options.marker !== undefined && options.marker !== null) {
        local.set(DATABASE_COMPATIBILITY_VERSION_KEY, options.marker);
    }
    const legacyKey = legacyDatabaseCompatibilityVersionKey("Test Vault");
    if (options.legacyMarker !== undefined && options.legacyMarker !== null) {
        local.set(legacyKey, options.legacyMarker);
    }
    const settings = { versionUpFlash: options.versionUpFlash ?? "" };
    const saveSettingData = vi.fn().mockResolvedValue(undefined);
    const applySettings = vi.fn().mockResolvedValue(true);
    const setting = {
        currentSettings: () => settings,
        getSettingsMigrationState: () => migrationState(options.migration),
        getSmallConfig: (key: string) => local.get(key) ?? "",
        setSmallConfig: (key: string, value: string) => local.set(key, value),
        getDeviceLocalConfig: (key: string) => local.get(key) ?? null,
        deleteDeviceLocalConfig: (key: string) => local.delete(key),
        saveSettingData,
    };
    const core = {
        services: {
            setting,
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
    return { controller, ui, local, legacyKey, settings, saveSettingData, applySettings };
}

describe("compatibility review controller", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("initialises the acknowledged version for a new Vault without showing a pause", async () => {
        const fixture = createFixture({ marker: null, migration: { isNewVault: true } });

        await expect(fixture.controller.initialise()).resolves.toBe(true);

        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.saveSettingData).not.toHaveBeenCalled();
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
        expect(fixture.local.has(fixture.legacyKey)).toBe(false);
        expect(fixture.controller.pendingPause).toBeDefined();
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
});
