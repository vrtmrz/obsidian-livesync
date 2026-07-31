import { promiseWithResolvers } from "octagonal-wheels/promises";
import { describe, expect, it, vi } from "vitest";
import { ObsidianReplicatorService } from "./ObsidianServices";

function handler() {
    return { addHandler: vi.fn() };
}

describe("ObsidianReplicatorService", () => {
    it("tracks local application activity without extending remote activity", async () => {
        const activity = promiseWithResolvers<void>();
        const service = new ObsidianReplicatorService({ events: {}, translate: String } as never, {
            settingService: { onRealiseSetting: handler() },
            appLifecycleService: { onSuspending: handler(), getUnresolvedMessages: handler() },
            databaseEventService: {
                onResetDatabase: handler(),
                onDatabaseInitialisation: handler(),
                onDatabaseInitialised: handler(),
                onDatabaseHasReady: handler(),
            },
            activityRunner: { run: vi.fn(async (task: () => Promise<void>) => await task()) },
        } as never);

        const running = service.runBoundedLocalApplicationActivity(() => activity.promise);

        expect(service.boundedLocalApplicationActivityCount.value).toBe(1);
        expect(service.boundedRemoteActivityCount.value).toBe(0);

        activity.resolve();
        await running;

        expect(service.boundedLocalApplicationActivityCount.value).toBe(0);
        expect(service.boundedRemoteActivityCount.value).toBe(0);
    });
});
