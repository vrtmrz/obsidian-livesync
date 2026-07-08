// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/types";
import type { IConversionAdapter } from "@lib/serviceModules/adapters";
import type { TFile, TFolder } from "obsidian";
/**
 * Conversion adapter implementation for Obsidian
 */
export declare class ObsidianConversionAdapter implements IConversionAdapter<TFile, TFolder> {
    nativeFileToUXFileInfoStub(file: TFile): UXFileInfoStub;
    nativeFolderToUXFolder(folder: TFolder): UXFolderInfo;
}
