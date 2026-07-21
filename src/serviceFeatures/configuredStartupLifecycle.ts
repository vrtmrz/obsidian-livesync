export interface ConfiguredStartupLifecycleRuntime {
    databaseReady: boolean;
    reportDatabaseNotReady(): void;
    hasCompromisedChunks(): Promise<boolean>;
    hasIncompleteDocuments(): Promise<boolean>;
    waitForCompatibilityReview(): Promise<void>;
    runDoctor(): Promise<boolean>;
    migrateBulkSend(): Promise<void>;
}

export interface StartupEntryLifecycleRuntime {
    configured: boolean;
    inviteToOnboarding(): void;
}

/**
 * Keeps an unconfigured Vault outside database initialisation and all
 * configured-only start-up work while offering an explicit setup action.
 */
export function runStartupEntryLifecycle(runtime: StartupEntryLifecycleRuntime): boolean {
    if (runtime.configured) return true;
    runtime.inviteToOnboarding();
    return false;
}

/**
 * Separates the inert, unconfigured startup path from checks which must run
 * before an already configured device is allowed to synchronise.
 */
export async function runConfiguredStartupLifecycle(runtime: ConfiguredStartupLifecycleRuntime): Promise<boolean> {
    if (!runtime.databaseReady) {
        runtime.reportDatabaseNotReady();
        return false;
    }
    if (!(await runtime.hasCompromisedChunks())) return false;
    if (!(await runtime.hasIncompleteDocuments())) return false;
    await runtime.waitForCompatibilityReview();
    if (!(await runtime.runDoctor())) return false;
    await runtime.migrateBulkSend();
    return true;
}
