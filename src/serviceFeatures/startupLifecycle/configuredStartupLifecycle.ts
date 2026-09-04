import type { ConfiguredStartupLifecycleOperations, StartupLifecycleValue } from "./types";

function readValue<T>(value: StartupLifecycleValue<T>): T {
    return typeof value === "function" ? (value as () => T)() : value;
}

/**
 * Keeps an unconfigured Vault outside database initialisation and all
 * configured-only start-up work while offering an explicit setup action.
 */
export interface StartupEntryLifecycleRuntime {
    readonly configured: StartupLifecycleValue<boolean>;
    readonly inviteToOnboarding: () => void;
}

export function runStartupEntryLifecycle(runtime: StartupEntryLifecycleRuntime): boolean {
    if (readValue(runtime.configured)) return true;
    runtime.inviteToOnboarding();
    return false;
}

/**
 * Separates the inert, unconfigured start-up path from checks which must run
 * before an already configured device is allowed to synchronise.
 */
export async function runConfiguredStartupLifecycle(runtime: ConfiguredStartupLifecycleOperations): Promise<boolean> {
    if (!readValue(runtime.databaseReady)) {
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
