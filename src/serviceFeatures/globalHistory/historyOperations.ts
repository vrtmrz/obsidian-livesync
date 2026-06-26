import { VIEW_TYPE_GLOBAL_HISTORY } from "@/modules/features/GlobalHistory/GlobalHistoryView.ts";
import type { GlobalHistoryHost } from "./types.ts";

/**
 * Shows the global vault history window.
 *
 * @param host - The service feature host context.
 */
export function showGlobalHistory(host: GlobalHistoryHost): void {
    void host.services.API.showWindow(VIEW_TYPE_GLOBAL_HISTORY);
}
