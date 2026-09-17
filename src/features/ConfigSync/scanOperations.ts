import type {
    AnyEntry,
    FilePath,
    FilePathWithPrefix,
    InternalFileEntry,
    LOG_LEVEL,
    ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { shareRunningResult } from "octagonal-wheels/concurrency/lock";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";

import { $msg } from "@/common/translation";
import { ICXHeader } from "@/common/types.ts";
import {
    collectOptionalFileSyncFiles,
    type OptionalFileSyncFileTreeDependencies,
} from "@/features/optionalFileSyncFileTree.ts";
import type { CatalogueOperations } from "./catalogueOperations.ts";
import type { CustomisationSyncPathOperations } from "./customisationSyncPathOperations.ts";
import type { SnapshotOperations } from "./snapshotOperations.ts";

type ScanSettings = Pick<ObsidianLiveSyncSettings, "usePluginSyncV2">;
type ScanDatabase = Pick<LiveSyncLocalDB, "allDocsRaw" | "findEntries">;
type ScanPathOperations = Pick<
    CustomisationSyncPathOperations,
    "isTargetPath" | "filenameToUnifiedKey" | "filenameWithUnifiedKey" | "unifiedKeyPrefixOfTerminal"
> & {
    getPath(entry: AnyEntry): FilePathWithPrefix;
};
type ScanSnapshotOperations = Pick<
    SnapshotOperations,
    "storeCustomisationFileV2" | "storeCustomizationFiles" | "deleteConfigOnDatabase"
>;
type ScanCatalogueOperations = Pick<CatalogueOperations, "updatePluginList">;

export type ScanOperationsDependencies = OptionalFileSyncFileTreeDependencies & {
    getSettings(): ScanSettings;
    getLocalDatabase(): ScanDatabase;
    path: ScanPathOperations;
    log: LogFunction;
    getConfigDir(): string;
    getDeviceAndVaultName(): string;
    ownsLocalFile(path: FilePath): boolean;
    ownsLocalDocument(path: FilePathWithPrefix): boolean;
    snapshotOperations: ScanSnapshotOperations;
    catalogueOperations: ScanCatalogueOperations;
};

/**
 * Owns Customisation Sync file enumeration and reconciliation with the local
 * database. Snapshot writes and catalogue publication remain explicit ports so
 * scans do not depend on the context or its lifecycle.
 */
export class ScanOperations {
    constructor(private readonly dependencies: ScanOperationsDependencies) {}

    private get localDatabase() {
        return this.dependencies.getLocalDatabase();
    }

    private getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.dependencies.path.getPath(entry);
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string) {
        this.dependencies.log(message, level, key);
    }

    async scanInternalFiles(): Promise<FilePath[]> {
        const filenames = (
            await collectOptionalFileSyncFiles(this.dependencies, this.dependencies.getConfigDir(), {
                maxDepth: 2,
                onError: (path, error) => {
                    this._log(`Could not traverse(CustomisationSync):${path}`, LOG_LEVEL_INFO);
                    this._log(error, LOG_LEVEL_VERBOSE);
                },
            })
        )
            .filter((e) => e.startsWith("."))
            .filter((e) => !e.startsWith(".trash"));
        return filenames as FilePath[];
    }

    async scanAllConfigFiles(showMessage: boolean): Promise<void> {
        await shareRunningResult("scanAllConfigFiles", async () => {
            const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
            this._log("Scanning customizing files.", logLevel, "scan-all-config");
            const term = this.dependencies.getDeviceAndVaultName();
            if (term == "") {
                this._log($msg("We have to configure the device name"), LOG_LEVEL_NOTICE);
                return;
            }
            const filesAll = await this.scanInternalFiles();
            if (this.dependencies.getSettings().usePluginSyncV2) {
                await this.scanV2ConfigFiles(filesAll, term);
            } else {
                await this.scanV1ConfigFiles(filesAll, term);
            }
        });
    }

    private async scanV2ConfigFiles(filesAll: readonly FilePath[], term: string): Promise<void> {
        const filesAllUnified = filesAll
            .filter((e) => this.dependencies.path.isTargetPath(e))
            .map((e) => [this.dependencies.path.filenameWithUnifiedKey(e, term), e] as [FilePathWithPrefix, FilePath]);
        const localFileMap = new Map(filesAllUnified.map((e) => [e[0], e[1]]));
        const prefix = this.dependencies.path.unifiedKeyPrefixOfTerminal(term);
        const entries = this.localDatabase.findEntries(prefix + "", `${prefix}\u{10ffff}`, {
            include_docs: true,
        });
        const tasks = [] as (() => Promise<void>)[];
        const concurrency = 10;
        const semaphore = Semaphore(concurrency);
        for await (const item of entries) {
            if (item.path.indexOf("%") !== -1) {
                continue;
            }
            tasks.push(async () => {
                const releaser = await semaphore.acquire();
                try {
                    const unifiedFilenameWithKey = `${item._id}` as FilePathWithPrefix;
                    const localPath = localFileMap.get(unifiedFilenameWithKey);
                    if (localPath) {
                        if (this.dependencies.ownsLocalFile(localPath)) {
                            await this.dependencies.snapshotOperations.storeCustomisationFileV2(localPath, term);
                        }
                        localFileMap.delete(unifiedFilenameWithKey);
                    } else if (this.dependencies.ownsLocalDocument(this.getPath(item))) {
                        await this.dependencies.snapshotOperations.deleteConfigOnDatabase(unifiedFilenameWithKey);
                    }
                } catch (ex) {
                    this._log(`scanAllConfigFiles - Error: ${item._id}`, LOG_LEVEL_VERBOSE);
                    this._log(ex, LOG_LEVEL_VERBOSE);
                } finally {
                    releaser();
                }
            });
        }
        await Promise.all(tasks.map((e) => e()));
        // Extra files
        const taskExtra = [] as (() => Promise<void>)[];
        for (const [, filePath] of localFileMap) {
            if (!this.dependencies.ownsLocalFile(filePath)) continue;
            taskExtra.push(async () => {
                const releaser = await semaphore.acquire();
                try {
                    await this.dependencies.snapshotOperations.storeCustomisationFileV2(filePath, term);
                } catch (ex) {
                    this._log(`scanAllConfigFiles - Error: ${filePath}`, LOG_LEVEL_VERBOSE);
                    this._log(ex, LOG_LEVEL_VERBOSE);
                } finally {
                    releaser();
                }
            });
        }
        await Promise.all(taskExtra.map((e) => e()));
        fireAndForget(() => this.dependencies.catalogueOperations.updatePluginList(false));
    }

    private async scanV1ConfigFiles(filesAll: readonly FilePath[], term: string): Promise<void> {
        const files = filesAll
            .filter((e) => this.dependencies.path.isTargetPath(e))
            .map((e) => ({ key: this.dependencies.path.filenameToUnifiedKey(e), file: e }));
        const virtualPathsOfLocalFiles = [...new Set(files.map((e) => e.key))];
        const filesOnDB = (
            (
                await this.localDatabase.allDocsRaw({
                    startkey: ICXHeader + "",
                    endkey: `${ICXHeader}\u{10ffff}`,
                    include_docs: true,
                })
            ).rows.map((e) => e.doc) as InternalFileEntry[]
        ).filter((e) => !e.deleted);
        let deleteCandidate = filesOnDB.map((e) => this.getPath(e)).filter((e) => e.startsWith(`${ICXHeader}${term}/`));
        for (const vp of virtualPathsOfLocalFiles) {
            const p = files.find((e) => e.key == vp)?.file;
            if (!p) {
                this._log(`scanAllConfigFiles - File not found: ${vp}`, LOG_LEVEL_VERBOSE);
                continue;
            }
            if (this.dependencies.ownsLocalFile(p)) {
                await this.dependencies.snapshotOperations.storeCustomizationFiles(p);
            }
            deleteCandidate = deleteCandidate.filter((e) => e != vp);
        }
        for (const vp of deleteCandidate) {
            if (this.dependencies.ownsLocalDocument(vp)) {
                await this.dependencies.snapshotOperations.deleteConfigOnDatabase(vp);
            }
        }
        fireAndForget(() => this.dependencies.catalogueOperations.updatePluginList(false));
    }
}
