import type { AnyEntry, LOG_LEVEL } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

import { CatalogueState } from "./catalogueState.ts";
import { loadCustomisationDisplayData, type CustomisationSyncReadCodec } from "./customisationSyncReadOperations.ts";

type CatalogueV1Database = Pick<LiveSyncLocalDB, "getDBEntry" | "putDBEntry">;

export type CatalogueV1Dependencies = {
    getLocalDatabase(): CatalogueV1Database;
    path: Pick<IPathService, "getPath">;
    log: LogFunction;
    state: CatalogueState;
};

/** Loads and publishes legacy V1 catalogue rows. */
export class CatalogueV1 {
    constructor(private readonly dependencies: CatalogueV1Dependencies) {}

    private _log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }

    async load(entry: AnyEntry, codec: CustomisationSyncReadCodec): Promise<void> {
        const path = entry.path || this.dependencies.path.getPath(entry);
        const oldEntry = this.dependencies.state.findPlugin(path);
        if (oldEntry && oldEntry.mtime == entry.mtime) return;
        try {
            const pluginData = await loadCustomisationDisplayData(
                {
                    getLocalDatabase: () => this.dependencies.getLocalDatabase(),
                    path: this.dependencies.path,
                    log: this.dependencies.log,
                },
                path,
                codec
            );
            if (pluginData) {
                this.dependencies.state.replacePlugin(pluginData);
            }
            // Failed to load
        } catch (ex) {
            this._log(`Something happened at enumerating customization :${path}`, LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
    }
}
