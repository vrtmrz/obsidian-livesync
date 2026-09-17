import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

import {
    createCustomisationSyncDevicePrefix,
    createCustomisationSyncV1DocumentPath,
    createCustomisationSyncV2DocumentPath,
    getCustomisationSyncFileCategory,
    isCustomisationSyncTargetPath,
    type CustomisationSyncFileCategory,
    type CustomisationSyncPathOptions,
} from "./customisationSyncPaths.ts";

/** Live projections needed to derive Customisation Sync paths. */
export type CustomisationSyncPathOperationsDependencies = Readonly<{
    getConfigDir: () => string;
    getUseV2: () => boolean;
    getUsePluginEtc: () => boolean;
    getDeviceAndVaultName: () => string;
}>;

/** Path operations exposed to the Customisation Sync context. */
export type CustomisationSyncPathOperations = Readonly<{
    getFileCategory(filePath: string): CustomisationSyncFileCategory;
    isTargetPath(filePath: string): boolean;
    filenameToUnifiedKey(path: string, termOverride?: string): FilePathWithPrefix;
    filenameWithUnifiedKey(path: string, termOverride?: string): FilePathWithPrefix;
    unifiedKeyPrefixOfTerminal(termOverride?: string): FilePathWithPrefix;
}>;

function getPathOptions(dependencies: CustomisationSyncPathOperationsDependencies): CustomisationSyncPathOptions {
    return {
        configDir: dependencies.getConfigDir(),
        useV2: dependencies.getUseV2(),
        usePluginEtc: dependencies.getUsePluginEtc(),
    };
}

export function createCustomisationSyncPathOperations(
    dependencies: CustomisationSyncPathOperationsDependencies
): CustomisationSyncPathOperations {
    return Object.freeze({
        getFileCategory: (filePath: string) => getCustomisationSyncFileCategory(filePath, getPathOptions(dependencies)),
        isTargetPath: (filePath: string) => isCustomisationSyncTargetPath(filePath, getPathOptions(dependencies)),
        filenameToUnifiedKey: (path: string, termOverride?: string) =>
            createCustomisationSyncV1DocumentPath(
                path,
                termOverride || dependencies.getDeviceAndVaultName(),
                getPathOptions(dependencies)
            ),
        filenameWithUnifiedKey: (path: string, termOverride?: string) =>
            createCustomisationSyncV2DocumentPath(
                path,
                termOverride || dependencies.getDeviceAndVaultName(),
                getPathOptions(dependencies)
            ),
        unifiedKeyPrefixOfTerminal: (termOverride?: string) =>
            createCustomisationSyncDevicePrefix(termOverride || dependencies.getDeviceAndVaultName()),
    });
}
