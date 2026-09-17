import type { PluginManifest } from "@/deps.ts";
import type { FilePathWithPrefix, LoadedEntry, LOG_LEVEL } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

import { scheduleTask } from "@/common/utils.ts";
import { CatalogueState } from "./catalogueState.ts";
import { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";
import { parseCustomisationSyncV2DocumentPath } from "./customisationSyncPaths.ts";
import { decodeCustomisationSyncV2File, loadCustomisationV2Entry } from "./customisationSyncReadOperations.ts";
import type { LoadedEntryPluginDataExFile } from "./customisationSyncView.ts";

type CatalogueV2Database = Pick<LiveSyncLocalDB, "getDBEntry">;

export type CatalogueV2Dependencies = {
    getLocalDatabase(): CatalogueV2Database;
    log: LogFunction;
    state: CatalogueState;
    codec: { dummyEnd: string };
};

/** Builds, updates, and publishes V2 catalogue rows and manifests. */
export class CatalogueV2 {
    constructor(private readonly dependencies: CatalogueV2Dependencies) {}

    private _log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }

    get manifestLookup() {
        return this.dependencies.state.manifestLookup;
    }

    async createPluginDataExFileV2(
        unifiedPathV2: FilePathWithPrefix,
        loaded?: LoadedEntry
    ): Promise<false | LoadedEntryPluginDataExFile> {
        // Compatibility: a caller-supplied entry bypasses the database lookup
        // and the isLoadedEntry check performed by loadCustomisationV2Entry.
        const loadedEntry =
            loaded ??
            (await loadCustomisationV2Entry(
                {
                    getLocalDatabase: () => this.dependencies.getLocalDatabase(),
                    log: this.dependencies.log,
                },
                unifiedPathV2
            ));
        if (!loadedEntry) return false;
        const { confKey, file, isManifest } = decodeCustomisationSyncV2File(
            unifiedPathV2,
            loadedEntry,
            this.dependencies.codec.dummyEnd
        );
        if (isManifest) {
            this.dependencies.state.processManifest(
                confKey,
                file.mtime,
                () => JSON.parse(file.data[0]) as PluginManifest,
                (error) => {
                    this._log(
                        `The file ${loadedEntry.path} seems to manifest, but could not be decoded as JSON`,
                        LOG_LEVEL_VERBOSE
                    );
                    this._log(error, LOG_LEVEL_VERBOSE);
                }
            );
        }
        return file;
    }

    createPluginDataFromV2(unifiedPathV2: FilePathWithPrefix): PluginDataExDisplayV2 | undefined {
        const { category, device, key, pathV1 } = parseCustomisationSyncV2DocumentPath(unifiedPathV2);
        if (category == "") return;

        return new PluginDataExDisplayV2(
            {
                documentPath: pathV1,
                category,
                name: key,
                term: `${device}`,
                files: [],
                mtime: 0,
            },
            this.dependencies.state.manifestLookup
        );
    }

    async updatePluginListV2(showMessage: boolean, unifiedFilenameWithKey: FilePathWithPrefix): Promise<void> {
        // The public parameter is retained for the established catalogue
        // signature; V2 publication has never used it.
        void showMessage;
        try {
            this.dependencies.state.beginUpdate();
            const { pathV1 } = parseCustomisationSyncV2DocumentPath(unifiedFilenameWithKey);

            const oldEntry = this.dependencies.state.findPlugin(pathV1);
            let entry: PluginDataExDisplayV2 | undefined;
            // Compatibility question: when a V1 row is found first for this
            // logical path, the inherited implementation constructs a fresh
            // V2 row rather than looking for another existing V2 row. Preserve
            // that selection until mixed-format catalogue races are covered.
            if (!oldEntry || !(oldEntry instanceof PluginDataExDisplayV2)) {
                entry = this.createPluginDataFromV2(unifiedFilenameWithKey);
            } else {
                entry = oldEntry;
            }
            if (!entry) return;

            const file = await this.createPluginDataExFileV2(unifiedFilenameWithKey);
            // Compatibility: the inherited update always re-adds an empty V2
            // row after deleting its final file.
            await this.dependencies.state.updateV2Plugin(entry, file, unifiedFilenameWithKey);

            scheduleTask("updatePluginListV2", 100, () => {
                this.dependencies.state.publishCatalogue();
            });
        } finally {
            this.dependencies.state.endUpdate();
        }
    }
}
