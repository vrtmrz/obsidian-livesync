import { describe, expect, it, vi } from "vitest";
import {
    applySettingsAndFetchOnActivation,
    applySettingsWithScheduledInitialisation,
    type SetupInitialisationScheduler,
} from "./setupActivationLifecycle";

function createScheduler() {
    const events: string[] = [];
    const scheduler: SetupInitialisationScheduler = {
        scheduleFetch: vi.fn(async (prepare) => {
            events.push("fetch-reserved");
            await prepare?.();
            return true;
        }),
        scheduleRebuild: vi.fn(async (prepare) => {
            events.push("rebuild-reserved");
            await prepare?.();
            return true;
        }),
    };
    const applySettings = vi.fn(async () => {
        events.push("settings-applied");
    });
    return { applySettings, events, scheduler };
}

describe("setup activation lifecycle", () => {
    it.each([
        ["fetch", "fetch-reserved"],
        ["rebuild", "rebuild-reserved"],
    ] as const)("reserves %s before applying settings", async (mode, reservedEvent) => {
        const { applySettings, events, scheduler } = createScheduler();

        await expect(applySettingsWithScheduledInitialisation(scheduler, mode, applySettings)).resolves.toBe(true);

        expect(events).toEqual([reservedEvent, "settings-applied"]);
    });

    it("reserves Fetch when existing settings activate an unconfigured device", async () => {
        const { applySettings, events, scheduler } = createScheduler();

        await expect(applySettingsAndFetchOnActivation(scheduler, false, true, applySettings)).resolves.toBe(true);

        expect(events).toEqual(["fetch-reserved", "settings-applied"]);
    });

    it("applies an ordinary configured-device edit without scheduling initialisation", async () => {
        const { applySettings, events, scheduler } = createScheduler();

        await expect(applySettingsAndFetchOnActivation(scheduler, true, true, applySettings)).resolves.toBe(true);

        expect(events).toEqual(["settings-applied"]);
        expect(scheduler.scheduleFetch).not.toHaveBeenCalled();
        expect(scheduler.scheduleRebuild).not.toHaveBeenCalled();
    });

    it("does not apply settings when the scheduler cannot reserve its flag", async () => {
        const { applySettings, scheduler } = createScheduler();
        vi.mocked(scheduler.scheduleFetch).mockResolvedValueOnce(false);

        await expect(applySettingsWithScheduledInitialisation(scheduler, "fetch", applySettings)).resolves.toBe(false);

        expect(applySettings).not.toHaveBeenCalled();
    });
});
