import { createObsidianServiceFeature } from "@/types.ts";
import { VIEW_TYPE_GLOBAL_HISTORY, GlobalHistoryView } from "@/modules/features/GlobalHistory/GlobalHistoryView.ts";
import type { WorkspaceLeaf } from "@/deps.ts";
import type { GlobalHistoryServices } from "./types.ts";
import { showGlobalHistory } from "./historyOperations.ts";

/**
 * A service feature hook that initialises and manages the Global History view.
 * Registers the global history view and ribbon command.
 */
export const useGlobalHistory = createObsidianServiceFeature<GlobalHistoryServices, never, "liveSyncPlugin">((host) => {
    const everyOnloadStart = (): Promise<boolean> => {
        host.services.API.addCommand({
            id: "livesync-global-history",
            name: "Show vault history",
            callback: () => {
                showGlobalHistory(host);
            },
        });

        const plugin = host.context.liveSyncPlugin;
        host.services.API.registerWindow(VIEW_TYPE_GLOBAL_HISTORY, (leaf: WorkspaceLeaf) => {
            return new GlobalHistoryView(leaf, plugin);
        });

        return Promise.resolve(true);
    };

    host.services.appLifecycle.onInitialise.addHandler(everyOnloadStart);
});
