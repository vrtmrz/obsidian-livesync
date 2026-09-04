import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type LoadedEntry,
    type LOG_LEVEL,
    type UXDataWriteOptions,
    type UXFileInfo,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    createBlob,
    isDocContentSame,
    readContent,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";

export type HiddenFileSyncStorageAccess = Pick<
    StorageAccess,
    | "ensureDir"
    | "isExistsIncludeHidden"
    | "readHiddenFileAuto"
    | "removeHidden"
    | "statHidden"
    | "triggerHiddenFile"
    | "writeHiddenFileAuto"
>;

type HiddenFileSyncStorageMethods<Method extends keyof HiddenFileSyncStorageAccess> = {
    storageAccess: Pick<HiddenFileSyncStorageAccess, Method>;
};

type HiddenFileSyncLogDependency = {
    log: LogFunction;
};

export type HiddenFileSyncStorageDependencies = HiddenFileSyncStorageMethods<keyof HiddenFileSyncStorageAccess> &
    HiddenFileSyncLogDependency;

export type HiddenFileSyncRemovalResult = "OK" | "ALREADY" | false;

function log(
    dependencies: HiddenFileSyncLogDependency,
    message: unknown,
    level?: LOG_LEVEL,
    key?: string
): void {
    dependencies.log(message, level, key);
}

export async function readHiddenFileWithInfo(
    dependencies: HiddenFileSyncStorageMethods<"readHiddenFileAuto" | "statHidden">,
    path: FilePath
): Promise<UXFileInfo> {
    const stat = await dependencies.storageAccess.statHidden(path);
    if (!stat) {
        return {
            name: path.split("/").pop() ?? "",
            path,
            stat: {
                size: 0,
                mtime: 0,
                ctime: 0,
                type: "file",
            },
            isInternal: true,
            deleted: true,
            body: createBlob(new Uint8Array(0)),
        };
    }
    const content = await dependencies.storageAccess.readHiddenFileAuto(path);
    return {
        name: path.split("/").pop() ?? "",
        path,
        stat,
        isInternal: true,
        deleted: false,
        body: createBlob(content),
    };
}

export async function ensureHiddenFileDirectory(
    dependencies: HiddenFileSyncStorageMethods<"ensureDir" | "isExistsIncludeHidden">,
    path: FilePath
): Promise<void> {
    if (!(await dependencies.storageAccess.isExistsIncludeHidden(path))) {
        // StorageAccess expects the complete target path and ensures its parent.
        await dependencies.storageAccess.ensureDir(path);
    }
}

export async function writeHiddenFile(
    dependencies: HiddenFileSyncStorageMethods<"statHidden" | "writeHiddenFileAuto">,
    path: FilePath,
    data: string | ArrayBuffer,
    options?: UXDataWriteOptions
): Promise<UXStat | null> {
    // Compatibility: the writer's Boolean result is ignored. The post-write stat
    // has historically decided whether the operation produced a usable file.
    await dependencies.storageAccess.writeHiddenFileAuto(path, data, options);
    return await dependencies.storageAccess.statHidden(path);
}

export async function removeHiddenFile(
    dependencies: HiddenFileSyncStorageMethods<"isExistsIncludeHidden" | "removeHidden"> &
        HiddenFileSyncLogDependency,
    path: FilePath
): Promise<HiddenFileSyncRemovalResult> {
    try {
        if (!(await dependencies.storageAccess.isExistsIncludeHidden(path))) {
            return "ALREADY";
        }
        if (await dependencies.storageAccess.removeHidden(path)) {
            return "OK";
        }
    } catch (error) {
        log(dependencies, `Failed to remove file:${path}`);
        log(dependencies, error, LOG_LEVEL_VERBOSE);
    }
    return false;
}

export async function triggerHiddenFileEvent(
    dependencies: HiddenFileSyncStorageMethods<"triggerHiddenFile"> & HiddenFileSyncLogDependency,
    path: FilePath
): Promise<void> {
    try {
        await dependencies.storageAccess.triggerHiddenFile(path);
    } catch (error) {
        log(dependencies, "Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
        log(dependencies, error, LOG_LEVEL_VERBOSE);
    }
}

export async function isHiddenFileWriteRequired(
    dependencies: HiddenFileSyncStorageMethods<"readHiddenFileAuto"> & HiddenFileSyncLogDependency,
    path: FilePath,
    content: string | ArrayBuffer
): Promise<boolean> {
    try {
        const storageContent = await dependencies.storageAccess.readHiddenFileAuto(path);
        return !(await isDocContentSame(storageContent, content));
    } catch (error) {
        log(dependencies, `Cannot check the content of ${path}`);
        log(dependencies, error, LOG_LEVEL_VERBOSE);
        // Compatibility: an unreadable current file is treated as requiring a
        // write. Changing this policy needs a separate recovery decision.
        return true;
    }
}

export async function writeHiddenFileFromDatabase(
    dependencies: HiddenFileSyncStorageMethods<
        "ensureDir" | "isExistsIncludeHidden" | "readHiddenFileAuto" | "statHidden" | "writeHiddenFileAuto"
    > &
        HiddenFileSyncLogDependency,
    path: FilePath,
    fileOnDatabase: LoadedEntry,
    force: boolean
): Promise<false | UXStat> {
    try {
        const statBefore = await dependencies.storageAccess.statHidden(path);
        const isExisting = statBefore != null;
        const content = readContent(fileOnDatabase);
        await ensureHiddenFileDirectory(dependencies, path);
        const writeRequired =
            force || !isExisting || (isExisting && (await isHiddenFileWriteRequired(dependencies, path, content)));

        if (!writeRequired) {
            log(dependencies, `STORAGE <-- DB: ${path}: skipped (hidden) Not changed`, LOG_LEVEL_DEBUG);
            return statBefore;
        }

        const statAfter = await writeHiddenFile(dependencies, path, content, {
            mtime: fileOnDatabase.mtime,
            ctime: fileOnDatabase.ctime,
        });
        if (statAfter == null) {
            log(dependencies, `STORAGE <-- DB: ${path}: written (hidden,new${force ? ", force" : ""}) Failed (writeResult)`);
            return false;
        }
        log(dependencies, `STORAGE <-- DB: ${path}: written (hidden, overwrite${force ? ", force" : ""})`);
        // Compatibility question: ordinary database reflection does not trigger
        // a raw storage event here; deletion and manual JSON merging do. Preserve
        // this until the event-loop consequences of changing it are characterised.
        return statAfter;
    } catch (error) {
        log(dependencies, `STORAGE <-- DB: ${path}: written (hidden, overwrite${force ? ", force" : ""}) Failed`);
        log(dependencies, error, LOG_LEVEL_VERBOSE);
        return false;
    }
}

export async function deleteHiddenFileFromStorage(
    dependencies: HiddenFileSyncStorageMethods<"isExistsIncludeHidden" | "removeHidden" | "triggerHiddenFile"> &
        HiddenFileSyncLogDependency,
    path: FilePath
): Promise<HiddenFileSyncRemovalResult> {
    const result = await removeHiddenFile(dependencies, path);
    if (result === false) {
        log(dependencies, `STORAGE <x- DB: ${path}: deleting (hidden) Failed`);
        return false;
    }
    if (result === "OK") {
        await triggerHiddenFileEvent(dependencies, path);
    }
    log(dependencies, `STORAGE <x- DB: ${path}: deleting (hidden) ${result == "OK" ? "Done" : "Already not found"}`);
    return result;
}
