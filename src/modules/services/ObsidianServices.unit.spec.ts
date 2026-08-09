import { promiseWithResolvers } from "octagonal-wheels/promises";
import { describe, expect, it, vi } from "vitest";
import { ObsidianReplicatorService, shouldAllowSleepDuringSynchronisation } from "./ObsidianServices";

function handler() {
    return { addHandler: vi.fn() };
}

describe("ObsidianReplicatorService", () => {
    it.each([
        { general: false, desktop: false, mobile: false, expected: false },
        { general: false, desktop: true, mobile: false, expected: true },
        { general: false, desktop: true, mobile: true, expected: false },
        { general: true, desktop: false, mobile: false, expected: true },
        { general: true, desktop: false, mobile: true, expected: true },
    ])("applies the sleep preference policy: $general/$desktop/$mobile", ({ general, desktop, mobile, expected }) => {
        expect(
            shouldAllowSleepDuringSynchronisation(
                {
                    allowSleepDuringSynchronisation: general,
                    allowSleepDuringSynchronisationOnDesktop: desktop,
                },
                mobile
            )
        ).toBe(expected);
    });

    it("tracks local application activity without extending remote activity", async () => {
        const activity = promiseWithResolvers<void>();
        const service = new ObsidianReplicatorService(
            { events: {}, translate: String } as never,
            {
                settingService: {
                    onRealiseSetting: handler(),
                    currentSettings: () => ({
                        allowSleepDuringSynchronisation: false,
                        allowSleepDuringSynchronisationOnDesktop: false,
                    }),
                },
                appLifecycleService: { onSuspending: handler(), getUnresolvedMessages: handler() },
                databaseEventService: {
                    onResetDatabase: handler(),
                    onDatabaseInitialisation: handler(),
                    onDatabaseInitialised: handler(),
                    onDatabaseHasReady: handler(),
                },
                activityRunner: { run: vi.fn(async (task: () => Promise<void>) => await task()) },
                isMobile: () => false,
            } as never
        );

        const running = service.runBoundedLocalApplicationActivity(() => activity.promise);

        expect(service.boundedLocalApplicationActivityCount.value).toBe(1);
        expect(service.boundedRemoteActivityCount.value).toBe(0);

        activity.resolve();
        await running;

        expect(service.boundedLocalApplicationActivityCount.value).toBe(0);
        expect(service.boundedRemoteActivityCount.value).toBe(0);
    });

    it("allows desktop sleep throughout bounded synchronisation activity when configured", async () => {
        const runWithWakeLock = vi.fn(async (task: () => Promise<void>) => await task());
        const service = new ObsidianReplicatorService(
            { events: {}, translate: String } as never,
            {
                settingService: {
                    onRealiseSetting: handler(),
                    currentSettings: () => ({
                        allowSleepDuringSynchronisation: false,
                        allowSleepDuringSynchronisationOnDesktop: true,
                    }),
                },
                appLifecycleService: { onSuspending: handler(), getUnresolvedMessages: handler() },
                databaseEventService: {
                    onResetDatabase: handler(),
                    onDatabaseInitialisation: handler(),
                    onDatabaseInitialised: handler(),
                    onDatabaseHasReady: handler(),
                },
                activityRunner: { run: runWithWakeLock },
                isMobile: () => false,
            } as never
        );

        await service.runBoundedRemoteActivity(async () => undefined);
        await service.runBoundedLocalApplicationActivity(async () => undefined);

        expect(runWithWakeLock).not.toHaveBeenCalled();
    });
});
