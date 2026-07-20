import { describe, expect, it, vi } from "vitest";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import { REVIEW_HARNESS_STATE_KEY } from "@/features/ReviewHarness/reviewHarnessController.ts";
import { useReviewHarness } from "./useReviewHarness.ts";

const VIEW_TYPE_REVIEW_HARNESS = "self-hosted-livesync-review-harness";

vi.mock("@/features/ReviewHarness/ReviewHarnessView", () => ({
    VIEW_TYPE_REVIEW_HARNESS: "self-hosted-livesync-review-harness",
    ReviewHarnessView: class {},
}));

function compatibilityPause(): CompatibilityPause {
    return {
        resumable: true,
        reasons: [
            {
                source: "settings-schema",
                sourceVersion: 9,
                currentVersion: 10,
                isFromFutureSchema: false,
                resumable: true,
            },
        ],
    };
}

function createFixture(options: { enableDebugTools?: boolean; continuation?: string } = {}) {
    const settingLoadedHandlers: Array<() => Promise<boolean>> = [];
    const layoutReadyHandlers: Array<() => Promise<boolean>> = [];
    const local = new Map<string, string>();
    if (options.continuation) local.set(REVIEW_HARNESS_STATE_KEY, options.continuation);
    const settings = {
        enableDebugTools: options.enableDebugTools ?? true,
        liveSync: false,
        syncOnSave: false,
        syncOnEditorSave: true,
        syncOnStart: false,
        syncOnFileOpen: true,
        syncAfterMerge: false,
        periodicReplication: true,
    };
    const services = {} as Record<string, unknown>;
    const replicator = { env: { services } };
    const api = {
        registerWindow: vi.fn(),
        addCommand: vi.fn(),
        showWindow: vi.fn().mockResolvedValue(undefined),
        addLog: vi.fn(),
        getPluginVersion: () => "1.0.0-rc.0",
        getAppVersion: () => "1.12.7",
        getPlatform: () => "desktop",
    };
    Object.assign(services, {
        setting: {
            currentSettings: () => settings,
            getSettingsMigrationState: () => ({
                sourceVersion: 9,
                targetVersion: 10,
                isNewVault: false,
                isFromFutureSchema: false,
                changed: true,
                requiresSyncReview: true,
                reviewReasons: [],
            }),
            getSmallConfig: (key: string) => local.get(key) ?? "",
            setSmallConfig: (key: string, value: string) => local.set(key, value),
            deleteSmallConfig: (key: string) => local.delete(key),
        },
        appLifecycle: {
            onSettingLoaded: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => settingLoadedHandlers.push(handler)),
            },
            onLayoutReady: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => layoutReadyHandlers.push(handler)),
            },
            performRestart: vi.fn(),
        },
        API: api,
        UI: {
            confirm: { askYesNoDialog: vi.fn().mockResolvedValue("no") },
        },
    });
    let pause: CompatibilityPause | undefined = compatibilityPause();
    const compatibilityReview = {
        initialised: true,
        get pendingPause() {
            return pause;
        },
        openReview: vi.fn(async () => {
            pause = undefined;
        }),
    };
    const core = { services };
    const plugin = {
        core,
        app: {
            vault: {},
            fileManager: {},
        },
    };

    const controller = useReviewHarness(core as never, plugin as never, { replicator } as never, compatibilityReview as never);
    return {
        controller,
        api,
        settings,
        local,
        settingLoadedHandlers,
        layoutReadyHandlers,
        compatibilityReview,
    };
}

describe("Review Harness composition", () => {
    it("does not register the command or view when developer debug tools are disabled", async () => {
        const fixture = createFixture({ enableDebugTools: false });

        await fixture.settingLoadedHandlers[0]();

        expect(fixture.api.registerWindow).not.toHaveBeenCalled();
        expect(fixture.api.addCommand).not.toHaveBeenCalled();
    });

    it("removes a one-shot continuation before reopening the Harness after layout", async () => {
        const requestedAt = "2026-07-18T11:59:00.000Z";
        const continuation = JSON.stringify({
            formatVersion: 1,
            requestId: `compatibility-review-${requestedAt}`,
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt,
        });
        const fixture = createFixture({ continuation });

        await fixture.settingLoadedHandlers[0]();

        expect(fixture.local.has(REVIEW_HARNESS_STATE_KEY)).toBe(false);
        expect(fixture.controller.snapshot().resumedRequestId).toBe(`compatibility-review-${requestedAt}`);
        expect(fixture.api.registerWindow).toHaveBeenCalledWith(VIEW_TYPE_REVIEW_HARNESS, expect.any(Function));

        await fixture.layoutReadyHandlers[0]();

        expect(fixture.api.showWindow).toHaveBeenCalledWith(VIEW_TYPE_REVIEW_HARNESS);
    });

    it("uses the actual compatibility controller as the guided review boundary", async () => {
        const fixture = createFixture();

        await fixture.controller.runScenario("compatibility-review");
        expect(fixture.controller.snapshot().results["compatibility-review"].status).toBe("waiting-for-user");

        await fixture.controller.openCompatibilityReview();

        expect(fixture.compatibilityReview.openReview).toHaveBeenCalledOnce();
        expect(fixture.controller.snapshot().results["compatibility-review"].status).toBe("passed");
    });
});
