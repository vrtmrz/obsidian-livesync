import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { fireAndForget } from "octagonal-wheels/promises";
import type { Editor, MarkdownFileInfo, MarkdownView } from "@/deps.ts";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_CONFLICT_CANCELLED, EVENT_PLUGIN_UNLOADED } from "@/common/events.ts";
import { createInteractiveConflictResolutionOperations } from "./operations";
import type { ConflictResolveDialogueFactory } from "./types";

export type InteractiveConflictResolutionHost = NecessaryServices<
    "API" | "UI" | "appLifecycle" | "conflict" | "replication" | "vault" | "database" | "setting" | "path",
    "databaseFileAccess"
>;

export function useInteractiveConflictResolutionFeature(
    host: InteractiveConflictResolutionHost,
    createDialogue: ConflictResolveDialogueFactory
): void {
    const services = host.services;
    const operations = createInteractiveConflictResolutionOperations({
        events: services.context.events,
        databaseFileAccess: host.serviceModules.databaseFileAccess,
        localDatabase: () => services.database.localDatabase,
        confirm: services.UI.confirm,
        path: services.path,
        vault: services.vault,
        appLifecycle: services.appLifecycle,
        conflict: services.conflict,
        replication: services.replication,
        currentSettings: () => services.setting.currentSettings(),
        createDialogue,
        log: createInstanceLogFunction("SF:InteractiveConflictResolution", services.API),
    });

    services.appLifecycle.onScanningStartupIssues.addHandler(operations.scanStartupIssues);
    services.appLifecycle.onInitialise.addHandler(() => {
        services.API.addCommand({
            id: "livesync-checkdoc-conflicted",
            name: "Resolve if conflicted.",
            editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                const file = view.file;
                if (!file) return;
                void operations.requestConflictResolution(file.path as FilePathWithPrefix);
            },
        });
        services.API.addCommand({
            id: "livesync-conflictcheck",
            name: "Pick a file to resolve conflict",
            callback: async () => {
                await operations.pickFileForResolve();
            },
        });
        services.API.addCommand({
            id: "livesync-all-conflictcheck",
            name: "Resolve all conflicted files",
            callback: async () => {
                await operations.allConflictCheck();
            },
        });
        return Promise.resolve(true);
    });
    services.appLifecycle.getUnresolvedMessages.addHandler(operations.getActiveConflictMessages);
    services.conflict.resolveByUserInteraction.addHandler(operations.resolveByUserInteraction);
    const offConflictCancelled = services.context.events.onEvent(EVENT_CONFLICT_CANCELLED, (filename) => {
        operations.invalidateWaitingResolution(filename);
        fireAndForget(() => operations.refreshConflictState(filename));
    });
    let featureDisposed = false;
    const dispose = () => {
        if (featureDisposed) return;
        featureDisposed = true;
        // Stop the refresh listener before cancellation so that unloading does
        // not start a database read which can race with database disposal.
        offConflictCancelled();
        operations.dispose();
    };
    const offPluginUnloaded = services.context.events.onceEvent(EVENT_PLUGIN_UNLOADED, dispose);
    services.appLifecycle.onUnload.addHandler(() => {
        offPluginUnloaded();
        dispose();
        return Promise.resolve(true);
    });
}

export { createInteractiveConflictResolutionOperations } from "./operations";
export type {
    InteractiveConflictResolutionOperations,
    InteractiveConflictResolutionOperationsDependencies,
} from "./operations";
export { POSTPONED } from "./types";
export type { ConflictResolveDialogue, ConflictResolveDialogueFactory, MergeDialogResult } from "./types";
