import type {
    FilePath,
    FilePathWithPrefix,
    LoadedEntry,
    LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    createSavingEntryFromLoadedEntry,
    fireAndForget,
    getDocData,
    getDocDataAsArray,
    isLoadedEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import { arrayBufferToBase64, readString } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/convert";
import { base64ToString } from "octagonal-wheels/binary/base64";

import type { PluginDataEx, PluginDataExFile } from "./customisationSyncCodec.ts";
import { getCustomisationSyncCategoryFolder, parseCustomisationSyncV2DocumentPath } from "./customisationSyncPaths.ts";
import type { LoadedEntryPluginDataExFile, PluginDataExDisplay } from "./customisationSyncView.ts";

type CustomisationSyncLogDependency = {
    log: LogFunction;
};

type CustomisationSyncStorageMethods<Method extends keyof StorageAccess> = {
    storageAccess: Pick<StorageAccess, Method>;
};

type CustomisationSyncDatabaseMethods<Method extends keyof LiveSyncLocalDB> = {
    getLocalDatabase(): Pick<LiveSyncLocalDB, Method>;
};

type CustomisationSyncPathMethods<Method extends keyof IPathService> = {
    path: Pick<IPathService, Method>;
};

export type CustomisationSyncFileReaderDependencies = CustomisationSyncStorageMethods<
    "readHiddenFileBinary" | "statHidden"
> &
    CustomisationSyncLogDependency;

export type CustomisationSyncDisplayLoaderDependencies = CustomisationSyncDatabaseMethods<"getDBEntry" | "putDBEntry"> &
    CustomisationSyncPathMethods<"getPath"> &
    CustomisationSyncLogDependency;

export type CustomisationSyncV2EntryLoaderDependencies = CustomisationSyncDatabaseMethods<"getDBEntry"> &
    CustomisationSyncLogDependency;

export type CustomisationSyncReadCodec = {
    deserialize<T>(source: string[], defaultValue: T): T;
    serialize(data: PluginDataEx): string;
};

export type DecodedCustomisationSyncV2File = {
    confKey: string;
    file: LoadedEntryPluginDataExFile;
    isManifest: boolean;
};

function log(dependencies: CustomisationSyncLogDependency, message: unknown, level?: LOG_LEVEL, key?: string): void {
    dependencies.log(message, level, key);
}

export async function readCustomisationFile(
    dependencies: CustomisationSyncFileReaderDependencies,
    path: FilePath,
    configDir: string
): Promise<false | PluginDataExFile> {
    const stat = await dependencies.storageAccess.statHidden(path);
    let version: string | undefined;
    let displayName: string | undefined;
    if (!stat) {
        return false;
    }
    const contentBin = await dependencies.storageAccess.readHiddenFileBinary(path);
    let content: string[];
    try {
        content = await arrayBufferToBase64(contentBin);
        if (path.toLowerCase().endsWith("/manifest.json")) {
            const manifestSource = readString(new Uint8Array(contentBin));
            try {
                const manifest: unknown = JSON.parse(manifestSource);
                if (typeof manifest === "object" && manifest !== null) {
                    if ("version" in manifest) {
                        version = String(manifest.version);
                    }
                    if ("name" in manifest) {
                        displayName = String(manifest.name);
                    }
                }
            } catch (error) {
                log(
                    dependencies,
                    `Configuration sync data: ${path} looks like manifest, but could not read the version`,
                    LOG_LEVEL_INFO
                );
                log(dependencies, error, LOG_LEVEL_VERBOSE);
            }
        }
    } catch (error) {
        log(dependencies, `The file ${path} could not be encoded`);
        log(dependencies, error, LOG_LEVEL_VERBOSE);
        return false;
    }
    return {
        // Compatibility: target validation belongs to the caller. The legacy
        // reader derives this name positionally without checking the prefix.
        filename: path.substring(configDir.length + 1),
        data: content,
        mtime: stat.mtime,
        size: stat.size,
        version,
        displayName,
    };
}

export async function loadCustomisationDisplayData(
    dependencies: CustomisationSyncDisplayLoaderDependencies,
    path: FilePathWithPrefix,
    codec: CustomisationSyncReadCodec
): Promise<PluginDataExDisplay | false> {
    const loaded = await dependencies.getLocalDatabase().getDBEntry(path, undefined, false, false);
    if (!loaded) {
        return false;
    }

    const data = codec.deserialize(getDocDataAsArray(loaded.data), {}) as PluginDataEx;
    const displayFiles: PluginDataExFile[] = [];
    let missingHash = false;
    for (const file of data.files) {
        const displayFile = { ...file, data: [] as string[] };
        if (!file.hash) {
            // Compatibility question: the inherited implementation clears the
            // display copy before calculating this temporary hash, so callers
            // see digestHash([]) until the asynchronously repaired document is
            // loaded again. The serialiser still writes the real content hash.
            const temporaryHashSource = getDocDataAsArray(displayFile.data);
            file.hash = digestHash(temporaryHashSource);
            missingHash = true;
        }
        displayFile.data = [file.hash];
        displayFiles.push(displayFile);
    }
    if (missingHash) {
        log(dependencies, `Digest created for ${path} to improve checking`, LOG_LEVEL_VERBOSE);
        loaded.data = codec.serialize(data);
        // Compatibility: catalogue loading does not wait for the repair write.
        fireAndForget(() => dependencies.getLocalDatabase().putDBEntry(createSavingEntryFromLoadedEntry(loaded)));
    }
    return {
        ...data,
        documentPath: dependencies.path.getPath(loaded),
        files: displayFiles,
    } satisfies PluginDataExDisplay;
}

export async function loadCustomisationV2Entry(
    dependencies: CustomisationSyncV2EntryLoaderDependencies,
    path: FilePathWithPrefix
): Promise<LoadedEntry | false> {
    const loaded = await dependencies.getLocalDatabase().getDBEntry(path);
    if (!loaded) {
        log(dependencies, `The file ${path} is not found`, LOG_LEVEL_VERBOSE);
        return false;
    }
    if (!isLoadedEntry(loaded)) {
        log(dependencies, `The file ${path} is not a note`, LOG_LEVEL_VERBOSE);
        return false;
    }
    return loaded;
}

export function decodeCustomisationSyncV2File(
    path: FilePathWithPrefix,
    loaded: LoadedEntry,
    dummyEnd: string
): DecodedCustomisationSyncV2File {
    const { category, key, filename, device } = parseCustomisationSyncV2DocumentPath(path);
    const categoryFolder = getCustomisationSyncCategoryFolder(category, device);
    const confKey = `${categoryFolder}${key}`;
    const relativeFilename =
        `${getCustomisationSyncCategoryFolder(category, "")}${category == "CONFIG" || category == "SNIPPET" ? "" : key + "/"}${filename}`.substring(
            1
        );
    const source = getDocData(loaded.data);
    const dataStart = source.indexOf(dummyEnd);
    // Compatibility question: a missing marker is not rejected. substring()
    // starts at dummyEnd.length - 1, preserving the old best-effort decode.
    const encodedData = source.substring(dataStart + dummyEnd.length);
    const file: LoadedEntryPluginDataExFile = {
        ...loaded,
        hash: "",
        data: [base64ToString(encodedData)],
        filename: relativeFilename,
        displayName: filename,
    };
    return {
        confKey,
        file,
        isManifest: filename == "manifest.json",
    };
}
