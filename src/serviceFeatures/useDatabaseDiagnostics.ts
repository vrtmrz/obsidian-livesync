import {
    createServiceFeature,
    type NecessaryServices,
} from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { EVENT_ANALYSE_DB_USAGE, EVENT_INSPECT_DB_INTEGRITY } from "@/common/events";
import { $msg } from "@/common/translation";
import DatabaseDiagnosticDialog from "@/modules/services/LiveSyncUI/dialogues/DatabaseDiagnosticDialog.svelte";
import { runDatabaseDiagnostic, type DatabaseDiagnosticKind } from "./databaseDiagnostics";
import type { DatabaseDiagnosticDialogOptions } from "./databaseDiagnosticDialogTypes";

type DatabaseDiagnosticsFeatureHost = NecessaryServices<
    "setting" | "database" | "path" | "API" | "UI" | "appLifecycle",
    "storageAccess"
>;

export const useDatabaseDiagnosticsFeature = createServiceFeature((host: DatabaseDiagnosticsFeatureHost) => {
    const { services } = host;
    let active: AbortController | undefined;
    const open = async (kind: DatabaseDiagnosticKind): Promise<void> => {
        if (active) return;
        const controller = new AbortController();
        active = controller;
        try {
            await services.UI.dialogManager.open<"close", DatabaseDiagnosticDialogOptions>(DatabaseDiagnosticDialog, {
                kind,
                run: async (nameMode, onProgress, includeRemote = true) => {
                    if (!services.database.isDatabaseReady()) throw new Error("local-database-unavailable");
                    return await runDatabaseDiagnostic(host, kind, nameMode, {
                        signal: controller.signal,
                        onProgress,
                        includeRemote,
                    });
                },
                cancel: () => controller.abort(),
            });
        } catch {
            // Closing the host during unload can reject the dialogue result.
            // Diagnostic errors are presented inside the dialogue without raw logs.
        } finally {
            controller.abort();
            if (active === controller) active = undefined;
        }
    };
    services.appLifecycle.onInitialise.addHandler(() => {
        services.API.addCommand({
            id: "analyse-database",
            name: "Analyse Database Usage (advanced)",
            icon: "database-search",
            checkCallback: (checking) => {
                if (!services.setting.currentSettings().useAdvancedMode || !services.database.isDatabaseReady())
                    return false;
                if (!checking) void open("usage");
                return true;
            },
        });
        services.API.addCommand({
            id: "inspect-database-integrity",
            name: $msg("Inspect database integrity"),
            icon: "database-search",
            checkCallback: (checking) => {
                if (!services.database.isDatabaseReady()) return false;
                if (!checking) void open("integrity");
                return true;
            },
        });
        return Promise.resolve(true);
    });
    const stopUsage = services.context.events.onEvent(EVENT_ANALYSE_DB_USAGE, () => void open("usage"));
    const stopIntegrity = services.context.events.onEvent(EVENT_INSPECT_DB_INTEGRITY, () => void open("integrity"));
    services.appLifecycle.onUnload.addHandler(() => {
        active?.abort();
        stopUsage();
        stopIntegrity();
        return Promise.resolve(true);
    });
    return { open };
});
