import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import { eventHub } from "@/common/events.ts";
import { EVENT_REQUEST_SHOW_HISTORY } from "@/common/obsidianEvents.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import type { DocumentHistoryServices, DocumentHistoryModules } from "./types.ts";
import { showHistory, fileHistory } from "./historyOperations.ts";

/**
 * A service feature hook that initialises and manages Obsidian Document History commands.
 * Registers ribbon commands and listens to history request events.
 */
export const useObsidianDocumentHistory = createObsidianServiceFeature<
    DocumentHistoryServices,
    DocumentHistoryModules,
    "app" | "liveSyncPlugin",
    void
>((host) => {
    const log = createInstanceLogFunction("ObsidianDocumentHistory", host.services.API);

    const everyOnloadStart = (): Promise<boolean> => {
        host.services.API.addCommand({
            id: "livesync-history",
            name: "Show history",
            callback: () => {
                const file = host.services.vault.getActiveFilePath();
                if (file) showHistory(host, file, undefined);
            },
        });

        host.services.API.addCommand({
            id: "livesync-filehistory",
            name: "Pick a file to show history",
            callback: () => {
                fireAndForget(async () => await fileHistory(host, log));
            },
        });

        eventHub.onEvent(EVENT_REQUEST_SHOW_HISTORY, ({ file, fileOnDB }: any) => {
            showHistory(host, file, fileOnDB._id);
        });
        return Promise.resolve(true);
    };

    host.services.appLifecycle.onInitialise.addHandler(everyOnloadStart);
});
