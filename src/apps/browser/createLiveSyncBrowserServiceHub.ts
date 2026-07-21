import { BrowserServiceHub, type BrowserServiceHost } from "@vrtmrz/livesync-commonlib/compat/services/BrowserServices";
import type { KeyValueDatabaseFactory } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { BrowserAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/browser/BrowserAPIService";
import { BrowserConfirm } from "./BrowserConfirm";
import { LiveSyncBrowserUIService } from "./LiveSyncBrowserUIService";
import { setLang, translateLiveSyncMessage } from "@/common/translation";

export type LiveSyncBrowserServiceHubOptions<T extends ServiceContext> = {
    context?: T;
    openKeyValueDatabase?: KeyValueDatabaseFactory;
};

function createLiveSyncBrowserHost<T extends ServiceContext>(): BrowserServiceHost<T> {
    return {
        createAPI(context) {
            return new BrowserAPIService(context, {
                confirm: new BrowserConfirm(context),
            });
        },
        createUI(context, dependencies) {
            return new LiveSyncBrowserUIService(context, dependencies);
        },
    };
}

export function createLiveSyncBrowserServiceHub<T extends ServiceContext>(
    options: LiveSyncBrowserServiceHubOptions<T> = {}
): BrowserServiceHub<T> {
    const context = options.context ?? (new ServiceContext({ translate: translateLiveSyncMessage }) as T);
    return new BrowserServiceHub<T>({
        ...options,
        context,
        onDisplayLanguageChanged: setLang,
        host: createLiveSyncBrowserHost<T>(),
    });
}
