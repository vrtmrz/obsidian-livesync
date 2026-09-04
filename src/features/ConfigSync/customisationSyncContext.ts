import type PouchDB from "pouchdb-core";
import { normalizePath } from "@/deps.ts";

import type {
    EntryDoc,
    LoadedEntry,
    FilePathWithPrefix,
    FilePath,
    AnyEntry,
    diff_result,
    SYNC_MODE,
    ObsidianLiveSyncSettings,
    LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, MODE_SELECTIVE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ICXHeader, PERIODIC_PLUGIN_SWEEP } from "@/common/types.ts";
import { cancelTask, scheduleTask } from "@/common/utils.ts";
import { $msg } from "@/common/translation";
import type { OptionalSyncFeatureMode } from "@/features/optionalSyncFeatures.ts";
import type {
    CustomisationSyncDialogView,
    CustomisationSyncUIControl,
    CustomisationSyncServiceHandlers,
    CustomisationSyncTestingView,
    IPluginDataExDisplay,
    LoadedEntryPluginDataExFile,
} from "./customisationSyncView.ts";
import {
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { IPathService, IReplicationService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { OptionalFileSyncFileTreeDependencies } from "@/features/optionalFileSyncFileTree.ts";
import { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";
import { ApplicationOperations, type ApplicationOperationsDependencies } from "./applicationOperations.ts";
import { CustomisationSyncRecentEventDeduplicator } from "./customisationSyncRecentEventDeduplicator.ts";
import { CatalogueOperations, type CatalogueOperationsDependencies } from "./catalogueOperations.ts";
import { SnapshotPersistence, type SnapshotPersistenceDependencies } from "./snapshotPersistence.ts";
import { SnapshotOperations } from "./snapshotOperations.ts";
import { ScanOperations, type ScanOperationsDependencies } from "./scanOperations.ts";
import {
    createCustomisationSyncPathOperations,
    type CustomisationSyncPathOperations,
} from "./customisationSyncPathOperations.ts";

export type { PluginDataEx, PluginDataExFile } from "./customisationSyncCodec.ts";
export type {
    CustomisationSyncFileCategory,
    CustomisationSyncServiceHandlers,
    CustomisationSyncTestingView,
    IPluginDataExDisplay,
    PluginDataExDisplay,
} from "./customisationSyncView.ts";
export { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";

const UPDATED_CONFIGURATION_NOTICE_KEY = "config-sync:updated-configuration";

type CustomisationSyncSettings = Pick<
    ObsidianLiveSyncSettings,
    | "usePluginSync"
    | "usePluginSyncV2"
    | "usePluginEtc"
    | "pluginSyncExtendedSetting"
    | "autoSweepPlugins"
    | "autoSweepPluginsPeriodic"
    | "watchInternalFileChanges"
    | "notifyPluginOrSettingUpdated"
>;

type CustomisationSyncDatabase = Pick<
    LiveSyncLocalDB,
    "allDocsRaw" | "findEntries" | "getDBEntry" | "getDBEntryFromMeta" | "getDBEntryMeta" | "putDBEntry" | "putRaw"
>;

type CustomisationSyncStorage = Pick<
    StorageAccess,
    "ensureDir" | "readHiddenFileBinary" | "readHiddenFileText" | "statHidden" | "writeHiddenFileAuto"
>;

export type CustomisationSyncPeriodicProcessor = {
    enable(interval: number): void;
    disable(): void;
};

export type CustomisationSyncContextDependencies = OptionalFileSyncFileTreeDependencies & {
    getSettings(): CustomisationSyncSettings;
    getLocalDatabase(): CustomisationSyncDatabase;
    storageAccess: CustomisationSyncStorage;
    path: Pick<IPathService, "getPath" | "isMarkedAsSameChanges" | "markChangesAreSame" | "path2id">;
    log: LogFunction;
    getConfigDir(): string;
    getDeviceAndVaultName(): string;
    setDeviceAndVaultName(name: string): void;
    saveSettingData(): Promise<void>;
    applySettings(partial: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean): Promise<void>;
    replicateUserInitiated: IReplicationService["replicateUserInitiated"];
    askString(title: string, key: string, placeholder: string): Promise<string | false>;
    isReady(): boolean;
    isSuspended(): boolean;
    askRestart(): void;
    createPeriodicProcessor(process: () => Promise<unknown>): CustomisationSyncPeriodicProcessor;
    resolveJsonConflict(
        path: FilePath,
        files: [LoadedEntryPluginDataExFile, LoadedEntryPluginDataExFile],
        remoteName: string,
        apply: (content: string) => Promise<boolean>
    ): Promise<boolean>;
    selectTextFile(path: FilePath, diffResult: diff_result, remoteName: string): Promise<"A" | "B" | false>;
    reloadPlugin(configDir: string, pluginName: string): Promise<void>;
    getFallbackDeviceName(): string;
    showConfigurationNotice(openDialog: () => void): void;
    hideConfigurationNotice(): void;
    getUIControl(): CustomisationSyncUIControl | undefined;
    ownsLocalFile(path: FilePath): boolean;
    ownsLocalDocument(path: FilePathWithPrefix): boolean;
    publishScanCount(count: number): void;
};

export class CustomisationSyncContext implements CustomisationSyncDialogView {
    private readonly dependencies: CustomisationSyncContextDependencies;
    private readonly pathOperations: CustomisationSyncPathOperations;
    private readonly snapshotPersistence: SnapshotPersistence;
    private readonly snapshotOperations: SnapshotOperations;
    private readonly catalogueOperations: CatalogueOperations;
    private readonly applicationOperations: ApplicationOperations;
    private readonly scanOperations: ScanOperations;
    private readonly recentProcessedInternalFiles = new CustomisationSyncRecentEventDeduplicator();
    private serviceHandlersView: CustomisationSyncServiceHandlers | undefined;
    private testingView: CustomisationSyncTestingView | undefined;

    private readonly periodicPluginSweepProcessor: CustomisationSyncPeriodicProcessor;

    constructor(dependencies: CustomisationSyncContextDependencies) {
        this.dependencies = dependencies;
        this.pathOperations = createCustomisationSyncPathOperations({
            getConfigDir: () => dependencies.getConfigDir(),
            getUseV2: () => dependencies.getSettings().usePluginSyncV2,
            getUsePluginEtc: () => dependencies.getSettings().usePluginEtc,
            getDeviceAndVaultName: () => dependencies.getDeviceAndVaultName(),
        });
        const snapshotPersistenceDependencies: SnapshotPersistenceDependencies = {
            getLocalDatabase: () => dependencies.getLocalDatabase(),
            storageAccess: dependencies.storageAccess,
            path: {
                ...this.pathOperations,
                path2id: (filename, prefix) => dependencies.path.path2id(filename, prefix),
                isMarkedAsSameChanges: (file, mtimes) => dependencies.path.isMarkedAsSameChanges(file, mtimes),
                markChangesAreSame: (file, newMtime, oldMtime) =>
                    dependencies.path.markChangesAreSame(file, newMtime, oldMtime),
            },
            log: (message, level, key) => dependencies.log(message, level, key),
            getConfigDir: () => dependencies.getConfigDir(),
        };
        this.snapshotPersistence = new SnapshotPersistence(snapshotPersistenceDependencies);
        this.catalogueOperations = new CatalogueOperations({
            getSettings: () => {
                const settings = dependencies.getSettings();
                return {
                    usePluginSync: settings.usePluginSync,
                    usePluginSyncV2: settings.usePluginSyncV2,
                };
            },
            getLocalDatabase: () => dependencies.getLocalDatabase(),
            path: {
                getPath: (entry) => dependencies.path.getPath(entry),
                path2id: (filename, prefix) => dependencies.path.path2id(filename, prefix),
            },
            log: (message, level, key) => dependencies.log(message, level, key),
            snapshotPersistence: this.snapshotPersistence,
            publishScanCount: (count) => dependencies.publishScanCount(count),
        } satisfies CatalogueOperationsDependencies);
        this.snapshotOperations = new SnapshotOperations({
            getSettings: () => ({ usePluginSyncV2: dependencies.getSettings().usePluginSyncV2 }),
            getDeviceAndVaultName: () => dependencies.getDeviceAndVaultName(),
            log: (message, level, key) => dependencies.log(message, level, key),
            snapshotPersistence: this.snapshotPersistence,
            catalogueOperations: this.catalogueOperations,
        });
        const applicationOperationsDependencies: ApplicationOperationsDependencies = {
            getLocalDatabase: () => ({ getDBEntry: (path) => dependencies.getLocalDatabase().getDBEntry(path) }),
            storageAccess: dependencies.storageAccess,
            path: {
                filenameToUnifiedKey: (path, termOverride) =>
                    this.pathOperations.filenameToUnifiedKey(path, termOverride),
            },
            log: (message, level, key) => dependencies.log(message, level, key),
            getConfigDir: () => dependencies.getConfigDir(),
            getDeviceAndVaultName: () => dependencies.getDeviceAndVaultName(),
            resolveJsonConflict: (path, files, remoteName, apply) =>
                dependencies.resolveJsonConflict(path, files, remoteName, apply),
            selectTextFile: (path, diffResult, remoteName) => dependencies.selectTextFile(path, diffResult, remoteName),
            reloadPlugin: (configDir, pluginName) => dependencies.reloadPlugin(configDir, pluginName),
            askRestart: () => dependencies.askRestart(),
            snapshotOperations: this.snapshotOperations,
            catalogueOperations: this.catalogueOperations,
        };
        this.applicationOperations = new ApplicationOperations(applicationOperationsDependencies);
        this.scanOperations = new ScanOperations({
            listFiles: async (path) => await dependencies.listFiles(path),
            getSettings: () => ({ usePluginSyncV2: dependencies.getSettings().usePluginSyncV2 }),
            getLocalDatabase: () => dependencies.getLocalDatabase(),
            path: {
                getPath: (entry) => dependencies.path.getPath(entry),
                isTargetPath: (path) => this.pathOperations.isTargetPath(path),
                filenameToUnifiedKey: (path, termOverride) =>
                    this.pathOperations.filenameToUnifiedKey(path, termOverride),
                filenameWithUnifiedKey: (path, termOverride) =>
                    this.pathOperations.filenameWithUnifiedKey(path, termOverride),
                unifiedKeyPrefixOfTerminal: (termOverride) =>
                    this.pathOperations.unifiedKeyPrefixOfTerminal(termOverride),
            },
            log: (message, level, key) => dependencies.log(message, level, key),
            getConfigDir: () => dependencies.getConfigDir(),
            getDeviceAndVaultName: () => dependencies.getDeviceAndVaultName(),
            ownsLocalFile: (path) => dependencies.ownsLocalFile(path),
            ownsLocalDocument: (path) => dependencies.ownsLocalDocument(path),
            snapshotOperations: this.snapshotOperations,
            catalogueOperations: this.catalogueOperations,
        } satisfies ScanOperationsDependencies);
        this.periodicPluginSweepProcessor = dependencies.createPeriodicProcessor(
            async () => await this.scanAllConfigFiles(false)
        );
    }

    get catalogue() {
        return this.catalogueOperations.catalogue;
    }

    get enumerationActive() {
        return this.catalogueOperations.enumerationActive;
    }

    get migrationProgress() {
        return this.catalogueOperations.migrationProgress;
    }

    get manifests() {
        return this.catalogueOperations.manifests;
    }

    /**
     * Semantic callbacks for registration by the optional-file composition
     * feature. The returned object is immutable, and each callback retains its
     * context without requiring callers to bind a concrete implementation.
     */
    get serviceHandlers(): CustomisationSyncServiceHandlers {
        if (!this.serviceHandlersView) {
            this.serviceHandlersView = Object.freeze({
                processOptionalFileEvent: (path: FilePath) => this.processOptionalFileEvent(path),
                processVirtualDocument: (docs: PouchDB.Core.ExistingDocument<EntryDoc>) =>
                    this.processVirtualDocument(docs),
                onRealiseSetting: () => this.realiseSettingSyncMode(),
                onResuming: () => this.onResumeProcess(),
                onBeforeReplicate: (showMessage: boolean) => this.beforeReplicate(showMessage),
                onDatabaseInitialised: (showNotice: boolean) => this.onDatabaseInitialised(showNotice),
                suspendExtraSync: () => this.suspendExtraSync(),
                enableOptionalFeature: (mode: OptionalSyncFeatureMode) => this.enableOptionalFeature(mode),
            });
        }
        return this.serviceHandlersView;
    }

    /**
     * Narrow internal surface used by maintained real-Obsidian contract tests.
     * It intentionally omits the context, queues, and writable stores.
     */
    get testing(): CustomisationSyncTestingView {
        if (!this.testingView) {
            this.testingView = Object.freeze({
                configDir: this.configDir,
                scanInternalFiles: async () => await this.scanOperations.scanInternalFiles(),
                scanAllConfigFiles: async (showMessage: boolean) => await this.scanAllConfigFiles(showMessage),
                storeCustomizationFiles: async (path: FilePath, termOverride?: string) =>
                    await this.snapshotOperations.storeCustomizationFiles(path, termOverride),
                deleteConfigOnDatabase: async (path: FilePathWithPrefix, forceWrite?: boolean) =>
                    await this.snapshotOperations.deleteConfigOnDatabase(path, forceWrite),
                createPluginDataFromV2: (path: FilePathWithPrefix) =>
                    this.catalogueOperations.createPluginDataFromV2(path),
                createPluginDataExFileV2: async (path: FilePathWithPrefix, loaded?: LoadedEntry) =>
                    await this.catalogueOperations.createPluginDataExFileV2(path, loaded),
                applyDataV2: async (data: PluginDataExDisplayV2, content?: string) =>
                    await this.applicationOperations.applyDataV2(data, content),
            });
        }
        return this.testingView;
    }

    private get configDir() {
        return this.dependencies.getConfigDir();
    }

    private get settings() {
        return this.dependencies.getSettings();
    }

    private get storageAccess() {
        return this.dependencies.storageAccess;
    }

    private getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.dependencies.path.getPath(entry);
    }

    private _isMainReady() {
        return this.dependencies.isReady();
    }

    private _isMainSuspended() {
        return this.dependencies.isSuspended();
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string) {
        this.dependencies.log(message, level, key);
    }

    private get useSyncPluginEtc() {
        return this.settings.usePluginEtc;
    }
    private isThisModuleEnabled() {
        return this.settings.usePluginSync;
    }

    isEnabled(): boolean {
        return this.isThisModuleEnabled();
    }

    getDeviceAndVaultName(): string {
        return this.dependencies.getDeviceAndVaultName();
    }

    getConfiguredModes() {
        return Object.values(this.settings.pluginSyncExtendedSetting).map((entry) => ({
            ...entry,
            files: [...entry.files],
        }));
    }

    isPluginEtcEnabled(): boolean {
        return this.useSyncPluginEtc;
    }

    updateConfiguredMode(key: string, mode: SYNC_MODE, files: string[]): void {
        if (mode == MODE_SELECTIVE) {
            delete this.settings.pluginSyncExtendedSetting[key];
        } else {
            this.settings.pluginSyncExtendedSetting[key] = {
                key,
                mode,
                files: [...files],
            };
        }
        void this.dependencies.saveSettingData();
    }

    getConfiguredTargetFiles(key: string): string[] {
        const configDir = normalizePath(this.configDir);
        return (this.settings.pluginSyncExtendedSetting[key]?.files ?? []).map((path) => `${configDir}/${path}`);
    }

    async synchronise(): Promise<void> {
        await this.dependencies.replicateUserInitiated({
            trigger: "manual",
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
    }

    askString(title: string, key: string, placeholder: string): Promise<string | false> {
        return this.dependencies.askString(title, key, placeholder);
    }

    async compareFileUsingDisplayData(
        dataA: IPluginDataExDisplay,
        dataB: IPluginDataExDisplay,
        filename: string
    ): Promise<boolean> {
        return await this.applicationOperations.compareFileUsingDisplayData(dataA, dataB, filename);
    }

    async duplicateData(data: IPluginDataExDisplay, deviceName: string): Promise<void> {
        await this.applicationOperations.duplicateData(data, deviceName);
    }

    dispose() {
        cancelTask(UPDATED_CONFIGURATION_NOTICE_KEY);
        this.periodicPluginSweepProcessor?.disable();
        this.catalogueOperations.dispose();
        this.dependencies.hideConfigurationNotice();
    }

    private async onDatabaseInitialised(showNotice: boolean) {
        if (!this.isThisModuleEnabled()) return true;
        try {
            this._log("Scanning customizations...");
            await this.scanAllConfigFiles(showNotice);
            this._log("Scanning customizations : done");
        } catch (ex) {
            this._log("Scanning customizations : failed");
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        return true;
    }
    private async beforeReplicate(showNotice: boolean) {
        if (!this.isThisModuleEnabled()) return true;
        if (this.settings.autoSweepPlugins) {
            await this.scanAllConfigFiles(showNotice);
            return true;
        }
        return true;
    }
    private async onResumeProcess(): Promise<boolean> {
        if (!this.isThisModuleEnabled()) return true;
        if (this._isMainSuspended()) {
            return true;
        }
        if (this.settings.autoSweepPlugins) {
            await this.scanAllConfigFiles(false);
        }
        this.periodicPluginSweepProcessor.enable(
            this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges
                ? PERIODIC_PLUGIN_SWEEP * 1000
                : 0
        );
        return true;
    }
    async reloadPluginList(showMessage: boolean) {
        await this.catalogueOperations.reloadPluginList(showMessage);
    }
    async updatePluginList(showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void> {
        await this.catalogueOperations.updatePluginList(showMessage, updatedDocumentPath);
    }
    async compareUsingDisplayData(dataA: IPluginDataExDisplay, dataB: IPluginDataExDisplay, compareEach = false) {
        return await this.applicationOperations.compareUsingDisplayData(dataA, dataB, compareEach);
    }
    async applyData(data: IPluginDataExDisplay, content?: string): Promise<boolean> {
        return await this.applicationOperations.applyData(data, content);
    }
    async deleteData(data: IPluginDataExDisplay): Promise<boolean> {
        return await this.applicationOperations.deleteData(data);
    }
    private async processVirtualDocument(docs: PouchDB.Core.ExistingDocument<EntryDoc>) {
        if (!docs._id.startsWith(ICXHeader)) return false;
        if (this.isThisModuleEnabled()) {
            await this.updatePluginList(
                false,
                (docs as AnyEntry).path ? (docs as AnyEntry).path : this.getPath(docs as AnyEntry)
            );
        }
        if (this.isThisModuleEnabled() && this.settings.notifyPluginOrSettingUpdated) {
            if (!this.dependencies.getUIControl()?.isOpen()) {
                scheduleTask(UPDATED_CONFIGURATION_NOTICE_KEY, 1000, () => {
                    this.dependencies.showConfigurationNotice(() => this.dependencies.getUIControl()?.open());
                });
            }
        }
        return true;
    }
    private async realiseSettingSyncMode(): Promise<boolean> {
        this.periodicPluginSweepProcessor?.disable();
        // Compatibility question: this inherited callback checks the method
        // reference rather than invoking it, then proceeds only while the host is
        // suspended. Preserve both gates until their intended lifecycle semantics
        // are verified and corrected under a separate behavioural test.
        if (!this._isMainReady) return true;
        if (!this._isMainSuspended()) return true;
        if (!this.isThisModuleEnabled()) return true;
        if (this.settings.autoSweepPlugins) {
            await this.scanAllConfigFiles(false);
        }
        this.periodicPluginSweepProcessor.enable(
            this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges
                ? PERIODIC_PLUGIN_SWEEP * 1000
                : 0
        );
        return true;
    }

    private async processOptionalFileEvent(path: FilePath): Promise<boolean> {
        return await this.watchVaultRawEventsAsync(path);
    }

    private async watchVaultRawEventsAsync(path: FilePath) {
        if (!this._isMainReady()) return false;
        if (this._isMainSuspended()) return false;
        if (!this.isThisModuleEnabled()) return false;
        if (!this.pathOperations.isTargetPath(path)) return false;
        if (!this.dependencies.ownsLocalFile(path)) return false;
        const stat = await this.storageAccess.statHidden(path);
        // Make sure that target is a file.
        if (stat && stat.type != "file") return false;

        // this._log(`Customization file detected: ${path}`, LOG_LEVEL_VERBOSE);
        const storageMTime = ~~(((stat && stat.mtime) || 0) / 1000);
        const key = `${path}-${storageMTime}`;
        if (!this.recentProcessedInternalFiles.admit(key)) {
            // If recently processed, it may caused by self.
            // return true to prevent pass the event to the next.
            return true;
        }
        // To prevent saving half-collected file sets.
        const keySchedule = this.pathOperations.filenameToUnifiedKey(path);
        scheduleTask(keySchedule, 100, async () => {
            await this.snapshotOperations.storeCustomizationFiles(path);
        });
        // Okay, it may handled after 100ms.
        // This was my own job.
        return true;
    }

    async scanAllConfigFiles(showMessage: boolean): Promise<void> {
        await this.scanOperations.scanAllConfigFiles(showMessage);
    }

    private suspendExtraSync(): Promise<boolean> {
        if (this.settings.usePluginSync || this.settings.autoSweepPlugins) {
            this._log(
                "Customisation sync have been temporarily disabled. Please enable them after the fetching, if you need them.",
                LOG_LEVEL_NOTICE
            );
            this.settings.usePluginSync = false;
            this.settings.autoSweepPlugins = false;
        }
        return Promise.resolve(true);
    }

    private async enableOptionalFeature(mode: OptionalSyncFeatureMode): Promise<boolean> {
        await this.configureCustomisationSync(mode);
        return true;
    }
    private async configureCustomisationSync(mode: OptionalSyncFeatureMode) {
        if (mode == "DISABLE") {
            await this.dependencies.applySettings(
                {
                    usePluginSync: false,
                },
                true
            );
            return;
        }

        if (mode == "CUSTOMIZE") {
            if (!this.dependencies.getDeviceAndVaultName()) {
                let name = await this.dependencies.askString(
                    $msg("Device name"),
                    $msg("Please set this device name"),
                    `desktop`
                );
                if (!name) {
                    name = this.dependencies.getFallbackDeviceName();
                }
                this.dependencies.setDeviceAndVaultName(name);
            }
            await this.dependencies.applySettings(
                {
                    usePluginSync: true,
                    useAdvancedMode: true,
                },
                true
            );
            await this.scanAllConfigFiles(true);
        }
    }
}
