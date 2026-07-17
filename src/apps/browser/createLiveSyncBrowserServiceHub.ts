import { BrowserServiceHub, type BrowserServiceHost } from "@vrtmrz/livesync-commonlib/compat/services/BrowserServices";
import type { KeyValueDatabaseFactory } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { BrowserAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/browser/BrowserAPIService";
import { BrowserConfirm } from "./BrowserConfirm";
import { LiveSyncBrowserUIService } from "./LiveSyncBrowserUIService";

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
    return new BrowserServiceHub<T>({
        ...options,
        host: createLiveSyncBrowserHost<T>(),
    });
}
