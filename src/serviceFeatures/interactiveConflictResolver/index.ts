import { createServiceFeature } from "@lib/interfaces/ServiceModule.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import type { ConflictResolverServices, ConflictResolverModules } from "./types.ts";
import { resolveConflictByUI, allConflictCheck, pickFileForResolve, allScanStat } from "./conflictOperations.ts";

/**
 * A service feature hook that initialises and manages the Interactive Conflict Resolver.
 * Registers conflict resolution commands and handles user-interactive resolution flows.
 */
export const useInteractiveConflictResolver = createServiceFeature<
    ConflictResolverServices,
    ConflictResolverModules,
    void
>((host) => {
    const log = createInstanceLogFunction("InteractiveConflictResolver", host.services.API);

    const everyOnloadStart = (): Promise<boolean> => {
        host.services.API.addCommand({
            id: "livesync-conflictcheck",
            name: "Pick a file to resolve conflict",
            callback: async () => {
                await pickFileForResolve(host, log);
            },
        });
        host.services.API.addCommand({
            id: "livesync-all-conflictcheck",
            name: "Resolve all conflicted files",
            callback: async () => {
                await allConflictCheck(host, log);
            },
        });
        return Promise.resolve(true);
    };

    // Bind event handlers onto services
    host.services.appLifecycle.onScanningStartupIssues.addHandler(() => allScanStat(host, log));
    host.services.appLifecycle.onInitialise.addHandler(everyOnloadStart);
    (host.services.conflict.resolveByUserInteraction as any).addHandler((filename: any, conflictCheckResult: any) =>
        resolveConflictByUI(host, log, filename, conflictCheckResult)
    );
});
