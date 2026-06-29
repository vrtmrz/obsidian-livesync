// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { TFile, type TAbstractFile, type TFolder } from "@/deps.ts";
import type { FilePathWithPrefix, UXFileInfo, UXFileInfoStub, UXFolderInfo, UXInternalFileInfoStub } from "@lib/common/types.ts";
import type { LiveSyncCore } from "@/main.ts";
import type { FileAccessObsidian } from "@/serviceModules/FileAccessObsidian.ts";
export declare function TFileToUXFileInfo(core: LiveSyncCore, file: TFile, prefix?: string, deleted?: boolean): Promise<UXFileInfo>;
export declare function InternalFileToUXFileInfo(fullPath: string, vaultAccess: FileAccessObsidian, prefix?: string): Promise<UXFileInfo>;
export declare function TFileToUXFileInfoStub(file: TFile | TAbstractFile, deleted?: boolean): UXFileInfoStub;
export declare function InternalFileToUXFileInfoStub(filename: FilePathWithPrefix, deleted?: boolean): UXInternalFileInfoStub;
export declare function TFolderToUXFileInfoStub(file: TFolder): UXFolderInfo;
