// Obsidian to LiveSync Utils

import { TFile, type TAbstractFile, type TFolder } from "../../../deps.ts";
import { ICHeader } from "../../../common/types.ts";
import type { SerializedFileAccess } from "./SerializedFileAccess.ts";
import { addPrefix, isPlainText } from "../../../lib/src/string_and_binary/path.ts";
import { LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import { createBlob } from "../../../lib/src/common/utils.ts";
import type {
    FilePath,
    FilePathWithPrefix,
    UXFileInfo,
    UXFileInfoStub,
    UXFolderInfo,
    UXInternalFileInfoStub,
} from "../../../lib/src/common/types.ts";
import type { LiveSyncCore } from "../../../main.ts";

export async function TFileToUXFileInfo(
    core: LiveSyncCore,
    file: TFile,
    prefix?: string,
    deleted?: boolean
): Promise<UXFileInfo> {
    const isPlain = isPlainText(file.name);
    const possiblyLarge = !isPlain;
    let content: Blob;
    if (deleted) {
        content = new Blob();
    } else {
        if (possiblyLarge) Logger(`Reading   : ${file.path}`, LOG_LEVEL_VERBOSE);
        content = createBlob(await core.storageAccess.readFileAuto(file.path));
        if (possiblyLarge) Logger(`Processing: ${file.path}`, LOG_LEVEL_VERBOSE);
    }
    // const datatype = determineTypeFromBlob(content);
    const bareFullPath = file.path as FilePathWithPrefix;
    const fullPath = prefix ? addPrefix(bareFullPath, prefix) : bareFullPath;

    return {
        name: file.name,
        path: fullPath,
        stat: {
            size: content.size,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            type: "file",
        },
        body: content,
    };
}

export async function InternalFileToUXFileInfo(
    fullPath: string,
    vaultAccess: SerializedFileAccess,
    prefix: string = ICHeader
): Promise<UXFileInfo> {
    const name = fullPath.split("/").pop() as string;
    const stat = await vaultAccess.tryAdapterStat(fullPath);
    if (stat == null) throw new Error(`File not found: ${fullPath}`);
    if (stat.type == "folder") throw new Error(`File not found: ${fullPath}`);
    const file = await vaultAccess.adapterReadAuto(fullPath);

    const isPlain = isPlainText(name);
    const possiblyLarge = !isPlain;
    if (possiblyLarge) Logger(`Reading   : ${fullPath}`, LOG_LEVEL_VERBOSE);
    const content = createBlob(file);
    if (possiblyLarge) Logger(`Processing: ${fullPath}`, LOG_LEVEL_VERBOSE);
    // const datatype = determineTypeFromBlob(content);
    const bareFullPath = fullPath as FilePathWithPrefix;
    const saveFullPath = prefix ? addPrefix(bareFullPath, prefix) : bareFullPath;

    return {
        name: name,
        path: saveFullPath,
        stat: {
            size: content.size,
            ctime: stat.ctime,
            mtime: stat.mtime,
            type: "file",
        },
        body: content,
    };
}

export function TFileToUXFileInfoStub(file: TFile | TAbstractFile, deleted?: boolean): UXFileInfoStub {
    if (!(file instanceof TFile)) {
        throw new Error("Invalid file type");
    }
    const ret: UXFileInfoStub = {
        name: file.name,
        path: file.path as FilePathWithPrefix,
        isFolder: false,
        stat: {
            size: file.stat.size,
            mtime: file.stat.mtime,
            ctime: file.stat.ctime,
            type: "file",
        },
        deleted: deleted,
    };
    return ret;
}
export function InternalFileToUXFileInfoStub(filename: FilePathWithPrefix, deleted?: boolean): UXInternalFileInfoStub {
    const name = filename.split("/").pop() as string;
    const ret: UXInternalFileInfoStub = {
        name: name,
        path: filename,
        isFolder: false,
        stat: undefined,
        isInternal: true,
        deleted,
    };
    return ret;
}
export function TFolderToUXFileInfoStub(file: TFolder): UXFolderInfo {
    const ret: UXFolderInfo = {
        name: file.name,
        path: file.path as FilePathWithPrefix,
        parent: file.parent?.path as FilePath | undefined,
        isFolder: true,
        children: file.children.map((e) => TFileToUXFileInfoStub(e)),
    };
    return ret;
}
