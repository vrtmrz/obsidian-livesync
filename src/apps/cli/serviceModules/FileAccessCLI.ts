import {
    FileAccessBase,
    type FileAccessBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase";
import { NodeFileSystemAdapter } from "@/apps/cli/adapters/NodeFileSystemAdapter";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { parseFilePath } from "@vrtmrz/livesync-commonlib/storage";
import { CLIFileNameSource } from "@/apps/cli/storage/CLIFileNameSource";
import type { StorageMutationCompletion } from "@/apps/cli/storage/ObservedNodeStorageAdapter";
import type { CLIPathFilterOptions } from "@/apps/cli/cliPathFilter";
import type { IgnoreRules } from "./IgnoreRules";
import { getPathNormalizationVersion } from "@vrtmrz/livesync-commonlib/settings";

const finishUnobservedMutation: StorageMutationCompletion = () => undefined;

/**
 * Composes CLI file access with an optional watched name inventory.
 *
 * Single-run commands retain physical enumeration. Watching commands share the
 * adapter's storage boundary with the name source, so local mutations invalidate
 * names before chokidar has delivered their notifications.
 */
export class FileAccessCLI extends FileAccessBase<NodeFileSystemAdapter> {
    /** Present only when this CLI instance owns the shared watcher lifecycle. */
    readonly fileNameSource?: CLIFileNameSource;

    constructor(
        basePath: string,
        dependencies: FileAccessBaseDependencies,
        watchOptions?: { ignoreRules?: IgnoreRules; pathFilterOptions?: CLIPathFilterOptions }
    ) {
        // The adapter must exist before the source can share its storage. This
        // closure reads the source when I/O begins, after composition has finished.
        let source: CLIFileNameSource | undefined;
        const invalidateFileNames = (paths: readonly string[]): StorageMutationCompletion => {
            if (source === undefined) {
                // Single-run commands have no inventory to update; the adapter
                // still receives the completion callback its mutation hook expects.
                return finishUnobservedMutation;
            }
            return source.invalidate(paths);
        };
        const pathNormalizationVersion = () =>
            getPathNormalizationVersion(dependencies.settingService.currentSettings());
        const isCaseInsensitive = () => {
            const settings = dependencies.settingService.currentSettings();
            return !settings.handleFilenameCaseSensitive || dependencies.vaultService.isStorageInsensitive();
        };
        const adapter = new NodeFileSystemAdapter(
            basePath,
            (message, detail) => {
                dependencies.APIService.addLog(message, LOG_LEVEL_NOTICE);
                if (detail !== undefined) {
                    dependencies.APIService.addLog(detail, LOG_LEVEL_NOTICE);
                }
            },
            pathNormalizationVersion,
            isCaseInsensitive,
            invalidateFileNames
        );
        super(adapter, dependencies);
        // Only the watching composition publishes indexed lookup. An empty
        // options object still requests watching; undefined selects single-run I/O.
        if (watchOptions) {
            source = new CLIFileNameSource(
                adapter.storage,
                () => ({
                    pathNormalizationVersion: getPathNormalizationVersion(
                        dependencies.settingService.currentSettings()
                    ),
                    handleFilenameCaseSensitive: !isCaseInsensitive(),
                }),
                {
                    basePath,
                    ignoreRules: watchOptions.ignoreRules,
                    pathFilterOptions: watchOptions.pathFilterOptions,
                    reportDiagnostic: (message, detail) => {
                        dependencies.APIService.addLog(message, LOG_LEVEL_NOTICE);
                        if (detail !== undefined) {
                            dependencies.APIService.addLog(detail, LOG_LEVEL_NOTICE);
                        }
                    },
                    suppressEvent: (path) => dependencies.storageAccessManager.isFileProcessing(parseFilePath(path)),
                }
            );
            adapter.fileNameLookup = source;
            this.fileNameSource = source;
        }
    }

    /** Expose the storage adapter to CLI operations which require physical scans. */
    get nodeAdapter(): NodeFileSystemAdapter {
        return this.adapter;
    }
}
