export type SetupInitialisationMode = "fetch" | "rebuild";

export interface SetupInitialisationScheduler {
    scheduleFetch(prepareBeforeRestart?: () => Promise<void>): Promise<boolean>;
    scheduleRebuild(prepareBeforeRestart?: () => Promise<void>): Promise<boolean>;
}

/**
 * Reserves the next-start initialisation operation before enabling settings.
 * The scheduler owns suspension, rollback, and restart ordering.
 */
export function applySettingsWithScheduledInitialisation(
    scheduler: SetupInitialisationScheduler,
    mode: SetupInitialisationMode,
    applySettings: () => Promise<void>
): Promise<boolean> {
    return mode === "fetch" ? scheduler.scheduleFetch(applySettings) : scheduler.scheduleRebuild(applySettings);
}

/**
 * Uses Fetch only for the transition from an unconfigured device to an
 * explicitly configured existing device. Ordinary edits apply immediately.
 */
export async function applySettingsAndFetchOnActivation(
    scheduler: SetupInitialisationScheduler,
    wasConfigured: boolean | undefined,
    willBeConfigured: boolean | undefined,
    applySettings: () => Promise<void>
): Promise<boolean> {
    if (!wasConfigured && willBeConfigured) {
        return await applySettingsWithScheduledInitialisation(scheduler, "fetch", applySettings);
    }
    await applySettings();
    return true;
}
