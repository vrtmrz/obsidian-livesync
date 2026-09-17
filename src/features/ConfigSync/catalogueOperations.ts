import { parseYaml } from "@/deps.ts";
import { writable } from "svelte/store";
import type {
    AnyEntry,
    FilePathWithPrefix,
    LoadedEntry,
    LOG_LEVEL,
    ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ICXHeader } from "@/common/types.ts";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { reactiveSource, type ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

import { CatalogueMigration } from "./catalogueMigration.ts";
import { CatalogueState } from "./catalogueState.ts";
import { CatalogueV1 } from "./catalogueV1.ts";
import { CatalogueV2 } from "./catalogueV2.ts";
import { createCustomisationSyncCodec } from "./customisationSyncCodec.ts";
import type { SnapshotPersistence } from "./snapshotPersistence.ts";
import type { IPluginDataExDisplay, LoadedEntryPluginDataExFile } from "./customisationSyncView.ts";

const {
    serialize,
    deserialize,
    dummyHead: DUMMY_HEAD,
    dummyEnd: DUMMY_END,
} = createCustomisationSyncCodec({ digestHash, parseYaml });
const READ_CODEC = { deserialize, serialize };
const MIGRATION_CODEC = { deserialize, dummyHead: DUMMY_HEAD, dummyEnd: DUMMY_END };
const V2_CODEC = { dummyEnd: DUMMY_END };

type CatalogueSettings = Pick<ObsidianLiveSyncSettings, "usePluginSync" | "usePluginSyncV2">;

type CatalogueDatabase = Pick<LiveSyncLocalDB, "findEntries" | "getDBEntry" | "putDBEntry">;

export type CatalogueOperationsDependencies = {
    getSettings(): CatalogueSettings;
    getLocalDatabase(): CatalogueDatabase;
    path: Pick<IPathService, "getPath" | "path2id">;
    log: LogFunction;
    snapshotPersistence: Pick<SnapshotPersistence, "deleteConfigOnDatabase">;
    publishScanCount(count: number): void;
};

/** Coordinates the shared catalogue state, scan queue, and format modules. */
export class CatalogueOperations {
    private readonly dependencies: CatalogueOperationsDependencies;
    private readonly catalogueState = new CatalogueState();
    private readonly scanProgress = reactiveSource(0);
    private readonly pluginScanningChanged: Parameters<ReactiveSource<number>["onChanged"]>[0] = (event) => {
        this.enumerationActive.set(event.value != 0);
        this.dependencies.publishScanCount(event.value);
    };
    private readonly pluginScanProcessor: QueueProcessor<AnyEntry, AnyEntry>;
    private readonly catalogueV1: CatalogueV1;
    private readonly catalogueV2: CatalogueV2;
    private readonly catalogueMigration: CatalogueMigration;

    readonly enumerationActive = writable(false);
    readonly catalogue = this.catalogueState.catalogue;
    readonly migrationProgress = this.catalogueState.migrationProgress;
    readonly manifests = this.catalogueState.manifests;

    constructor(dependencies: CatalogueOperationsDependencies) {
        this.dependencies = dependencies;

        this.catalogueV1 = new CatalogueV1({
            getLocalDatabase: () => this.dependencies.getLocalDatabase(),
            path: {
                getPath: (entry) => this.getPath(entry),
            },
            log: (message, level, key) => this._log(message, level, key),
            state: this.catalogueState,
        });
        this.catalogueV2 = new CatalogueV2({
            getLocalDatabase: () => this.dependencies.getLocalDatabase(),
            log: (message, level, key) => this._log(message, level, key),
            state: this.catalogueState,
            codec: V2_CODEC,
        });
        this.catalogueMigration = new CatalogueMigration({
            getLocalDatabase: () => this.dependencies.getLocalDatabase(),
            path: {
                path2id: (path) => this.path2id(path),
            },
            log: (message, level, key) => this._log(message, level, key),
            snapshotPersistence: this.dependencies.snapshotPersistence,
            refreshV1: async (showMessage, path) => await this.updatePluginList(showMessage, path),
            codec: MIGRATION_CODEC,
        });

        this.scanProgress.onChanged(this.pluginScanningChanged);
        // The single queue deliberately chooses V1 loading or migration when
        // each item starts. Settings can change after enqueueing an item.
        this.pluginScanProcessor = new QueueProcessor(
            async (v: AnyEntry[]) => {
                const plugin = v[0];
                if (this.dependencies.getSettings().usePluginSyncV2) {
                    await this.migrateV1ToV2(false, plugin);
                    return [];
                }
                await this.catalogueV1.load(plugin, READ_CODEC);
                return [];
            },
            {
                suspended: false,
                batchSize: 1,
                concurrentLimit: 10,
                delay: 100,
                yieldThreshold: 10,
                maintainDelay: false,
                totalRemainingReactiveSource: this.scanProgress,
            }
        ).startPipeline();
    }

    private get settings() {
        return this.dependencies.getSettings();
    }

    private get localDatabase() {
        return this.dependencies.getLocalDatabase();
    }

    private getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.dependencies.path.getPath(entry);
    }

    private async path2id(filename: FilePathWithPrefix) {
        return await this.dependencies.path.path2id(filename);
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }

    /** The current manifest lookup passed to V2 display rows. */
    get manifestLookup() {
        return this.catalogueState.manifestLookup;
    }

    /** Returns every row matching a document path, preserving legacy duplicates. */
    findPlugins(documentPath: FilePathWithPrefix | string): readonly IPluginDataExDisplay[] {
        return this.catalogueState.findPlugins(documentPath);
    }

    dispose(): void {
        this.pluginScanProcessor.terminate();
        this.scanProgress.offChanged(this.pluginScanningChanged);
        this.enumerationActive.set(false);
        this.dependencies.publishScanCount(0);
    }

    async reloadPluginList(showMessage: boolean): Promise<void> {
        this.catalogueState.clearForReload();
        await this.updatePluginList(showMessage);
    }

    async updatePluginList(showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void> {
        if (!this.settings.usePluginSync) {
            this.pluginScanProcessor.clearQueue();
            this.catalogueState.clearForDisabledRefresh();
            return;
        }
        try {
            this.catalogueState.beginUpdate();
            const updatedDocumentId = updatedDocumentPath ? await this.path2id(updatedDocumentPath) : "";
            const plugins = updatedDocumentPath
                ? this.localDatabase.findEntries(updatedDocumentId, updatedDocumentId + "\u{10ffff}", {
                      include_docs: true,
                      key: updatedDocumentId,
                      limit: 1,
                  })
                : this.localDatabase.findEntries(ICXHeader + "", `${ICXHeader}\u{10ffff}`, { include_docs: true });
            for await (const v of plugins) {
                if (v.deleted || v._deleted) continue;
                if (v.path.indexOf("%") !== -1) {
                    fireAndForget(() => this.updatePluginListV2(showMessage, v.path));
                    continue;
                }

                const path = v.path || this.getPath(v);
                if (updatedDocumentPath && updatedDocumentPath != path) continue;
                this.pluginScanProcessor.enqueue(v);
            }
        } finally {
            this.enumerationActive.set(false);
            this.catalogueState.endUpdate();
        }
        this.enumerationActive.set(false);
    }

    async createPluginDataExFileV2(
        unifiedPathV2: FilePathWithPrefix,
        loaded?: LoadedEntry
    ): Promise<false | LoadedEntryPluginDataExFile> {
        return await this.catalogueV2.createPluginDataExFileV2(unifiedPathV2, loaded);
    }

    createPluginDataFromV2(unifiedPathV2: FilePathWithPrefix) {
        return this.catalogueV2.createPluginDataFromV2(unifiedPathV2);
    }

    async updatePluginListV2(showMessage: boolean, unifiedFilenameWithKey: FilePathWithPrefix): Promise<void> {
        await this.catalogueV2.updatePluginListV2(showMessage, unifiedFilenameWithKey);
    }

    private async migrateV1ToV2(showMessage: boolean, entry: AnyEntry): Promise<void> {
        await this.catalogueMigration.migrateV1ToV2(showMessage, entry);
    }
}
