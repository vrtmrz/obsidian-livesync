import type {
    FilePath,
    FilePathWithPrefix,
    LOG_LEVEL,
    ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";

import { $msg } from "@/common/translation";
import type { CatalogueOperations } from "./catalogueOperations.ts";
import type { SnapshotPersistence, SnapshotRefresh } from "./snapshotPersistence.ts";

type SnapshotSettings = Pick<ObsidianLiveSyncSettings, "usePluginSyncV2">;
type SnapshotPersistencePort = Pick<
    SnapshotPersistence,
    "storeCustomisationFileV2" | "storeCustomizationFiles" | "deleteConfigOnDatabase"
>;
type SnapshotCatalogue = Pick<CatalogueOperations, "updatePluginList" | "updatePluginListV2">;

export type SnapshotOperationsDependencies = {
    getSettings(): SnapshotSettings;
    getDeviceAndVaultName(): string;
    log(message: unknown, level?: LOG_LEVEL, key?: string): void;
    snapshotPersistence: SnapshotPersistencePort;
    catalogueOperations: SnapshotCatalogue;
};

/**
 * Adapts host-neutral Customisation Sync snapshot mutations to catalogue
 * refreshes. Current-term selection and the inherited refresh timing live in
 * this owner so scan, dialogue, and testing callers share one policy.
 */
export class SnapshotOperations {
    constructor(private readonly dependencies: SnapshotOperationsDependencies) {}

    private _log(message: unknown, level?: LOG_LEVEL, key?: string) {
        this.dependencies.log(message, level, key);
    }

    isV2Enabled(): boolean {
        return this.dependencies.getSettings().usePluginSyncV2;
    }

    private async applyPersistenceRefreshes(refreshes: readonly SnapshotRefresh[]) {
        for (const refresh of refreshes) {
            if (refresh.mode == "v2" && refresh.timing == "fire-and-forget") {
                fireAndForget(() => this.dependencies.catalogueOperations.updatePluginListV2(false, refresh.path));
            } else if (refresh.mode == "v1" && refresh.timing == "await") {
                await this.dependencies.catalogueOperations.updatePluginList(false, refresh.path);
            }
        }
    }

    async storeCustomisationFileV2(path: FilePath, term: string, force = false) {
        const persistence = await this.dependencies.snapshotPersistence.storeCustomisationFileV2(path, term, force);
        await this.applyPersistenceRefreshes(persistence.refreshes);
        return persistence.value;
    }

    async storeCustomizationFiles(path: FilePath, termOverride?: string) {
        const term = termOverride || this.dependencies.getDeviceAndVaultName();
        if (term == "") {
            this._log($msg("We have to configure the device name"), LOG_LEVEL_NOTICE);
            return;
        }
        const persistence = this.isV2Enabled()
            ? await this.dependencies.snapshotPersistence.storeCustomisationFileV2(path, term)
            : await this.dependencies.snapshotPersistence.storeCustomizationFiles(path, term);
        await this.applyPersistenceRefreshes(persistence.refreshes);
        return persistence.value;
    }

    async deleteConfigOnDatabase(prefixedFileName: FilePathWithPrefix, forceWrite = false): Promise<boolean> {
        const persistence = await this.dependencies.snapshotPersistence.deleteConfigOnDatabase(
            prefixedFileName,
            forceWrite
        );
        await this.applyPersistenceRefreshes(persistence.refreshes);
        return persistence.value;
    }
}
