import type { InternalFileInfo } from "@/common/types.ts";
import type {
    FilePath,
    FilePathWithPrefix,
    LoadedEntry,
    UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { OptionalSyncFeatureMode } from "@/features/optionalSyncFeatures.ts";
import type { HiddenFileSyncConflictTestingView } from "./hiddenFileSyncConflictResolution.ts";

export type HiddenFileSyncInitialisationDirection = "push" | "pull" | "safe" | "pullForce" | "pushForce";

/** Initialisation operation needed by the Customisation Sync dialogue. */
export interface HiddenFileSyncInitialisationView {
    initialiseInternalFileSync(
        direction: HiddenFileSyncInitialisationDirection,
        showMessage: boolean,
        targetFiles?: string[] | false
    ): Promise<void>;
}

/**
 * Semantic callbacks consumed by the Commonlib service registries.
 *
 * The context owns the implementations, while the optional-file composition
 * adapts this view to Commonlib's aggregation contracts. Callers do not bind
 * the context or depend on registry-oriented method names.
 */
export interface HiddenFileSyncServiceHandlerView {
    readonly processOptionalFileEvent: (path: FilePath) => Promise<boolean>;
    readonly processOptionalSyncFiles: (doc: LoadedEntry) => Promise<boolean>;
    readonly onSettingLoaded: () => Promise<boolean>;
    readonly realiseSettingSyncMode: () => Promise<boolean>;
    readonly onResuming: () => Promise<boolean>;
    readonly beforeReplicate: (showNotice: boolean) => Promise<boolean>;
    readonly onDatabaseInitialised: (showNotice: boolean) => Promise<boolean>;
    readonly suspendExtraSync: () => Promise<boolean>;
    readonly configureOptionalSyncFeature: (mode: OptionalSyncFeatureMode) => Promise<boolean>;
    readonly isTargetFileEligible: (path: FilePath) => Promise<boolean>;
    readonly queueConflict: (path: FilePathWithPrefix) => Promise<boolean>;
}

export function createHiddenFileSyncServiceHandlerView(
    operations: HiddenFileSyncServiceHandlerView
): HiddenFileSyncServiceHandlerView {
    const view: HiddenFileSyncServiceHandlerView = {
        processOptionalFileEvent: async (path) => await operations.processOptionalFileEvent(path),
        processOptionalSyncFiles: async (doc) => await operations.processOptionalSyncFiles(doc),
        onSettingLoaded: async () => await operations.onSettingLoaded(),
        realiseSettingSyncMode: async () => await operations.realiseSettingSyncMode(),
        onResuming: async () => await operations.onResuming(),
        beforeReplicate: async (showNotice) => await operations.beforeReplicate(showNotice),
        onDatabaseInitialised: async (showNotice) => await operations.onDatabaseInitialised(showNotice),
        suspendExtraSync: async () => await operations.suspendExtraSync(),
        configureOptionalSyncFeature: async (mode) => await operations.configureOptionalSyncFeature(mode),
        isTargetFileEligible: async (path) => await operations.isTargetFileEligible(path),
        queueConflict: async (path) => await operations.queueConflict(path),
    };
    return Object.freeze(view);
}

export type HiddenFileSyncTestingRebuild = (
    showNotice: boolean,
    targetFiles?: FilePath[] | false
) => Promise<FilePath[]>;

export type HiddenFileSyncTestingRebuildInterceptor = (
    runRebuild: HiddenFileSyncTestingRebuild,
    showNotice: boolean,
    targetFiles?: FilePath[] | false
) => Promise<FilePath[]>;

/** Operations exposed to the real-Obsidian contract tests. */
export interface HiddenFileSyncTestingView extends HiddenFileSyncCommandView {
    readonly conflictResolution: HiddenFileSyncConflictTestingView;
    readFileWithInfo(path: FilePath): Promise<UXFileInfo>;
    showConfigurationChangeNotice(updatedFolders: readonly string[]): void;
    interceptRebuildMerging(interceptor: HiddenFileSyncTestingRebuildInterceptor): () => void;
}

export type HiddenFileSyncTestingViewOperations = HiddenFileSyncTestingView;

/**
 * Build the frozen testing seam. Tests can observe behaviour and install a
 * scoped timing interceptor, but cannot access mutable context state.
 */
export function createHiddenFileSyncTestingView(
    operations: HiddenFileSyncTestingViewOperations
): HiddenFileSyncTestingView {
    const view: HiddenFileSyncTestingView = {
        isManualCommandAvailable: () => operations.isManualCommandAvailable(),
        scanAllStorageChanges: async (showNotice) => await operations.scanAllStorageChanges(showNotice),
        scanAllDatabaseChanges: async (showNotice) => await operations.scanAllDatabaseChanges(showNotice),
        applyOfflineChanges: async (showNotice) => await operations.applyOfflineChanges(showNotice),
        updateSettingCache: () => operations.updateSettingCache(),
        initialiseInternalFileSync: async (direction, showMessage, targetFiles) =>
            await operations.initialiseInternalFileSync(direction, showMessage, targetFiles),
        conflictResolution: operations.conflictResolution,
        readFileWithInfo: async (path) => await operations.readFileWithInfo(path),
        showConfigurationChangeNotice: (updatedFolders) =>
            operations.showConfigurationChangeNotice(updatedFolders),
        interceptRebuildMerging: (interceptor) => operations.interceptRebuildMerging(interceptor),
    };
    return Object.freeze(view);
}

/** Exact-revision operations needed by the Hatch repair pane. */
export interface HiddenFileSyncRepairView {
    scanInternalFiles(): Promise<InternalFileInfo[]>;
    storeInternalFileToDatabase(file: InternalFileInfo, forceWrite?: boolean): Promise<boolean | undefined>;
    storeInternalFileToDatabaseWithBaseRevision(
        file: InternalFileInfo,
        baseRevision: string,
        createIfDifferent?: boolean
    ): Promise<boolean>;
    extractInternalFileRevisionFromDatabase(
        storageFilePath: FilePath,
        revision: string,
        force?: boolean
    ): Promise<boolean>;
}

export function createHiddenFileSyncRepairView(operations: HiddenFileSyncRepairView): HiddenFileSyncRepairView {
    const view: HiddenFileSyncRepairView = {
        scanInternalFiles: async () => await operations.scanInternalFiles(),
        storeInternalFileToDatabase: async (file, forceWrite) =>
            await operations.storeInternalFileToDatabase(file, forceWrite),
        storeInternalFileToDatabaseWithBaseRevision: async (file, baseRevision, createIfDifferent) =>
            await operations.storeInternalFileToDatabaseWithBaseRevision(file, baseRevision, createIfDifferent),
        extractInternalFileRevisionFromDatabase: async (storageFilePath, revision, force) =>
            await operations.extractInternalFileRevisionFromDatabase(storageFilePath, revision, force),
    };
    return Object.freeze(view);
}

/** Operations consumed by the host-owned Hidden File Sync commands. */
export interface HiddenFileSyncCommandView extends HiddenFileSyncInitialisationView {
    isManualCommandAvailable(): boolean;
    scanAllStorageChanges(showNotice: boolean): Promise<unknown>;
    scanAllDatabaseChanges(showNotice: boolean): Promise<unknown>;
    applyOfflineChanges(showNotice: boolean): Promise<unknown>;
    updateSettingCache(): void;
}
