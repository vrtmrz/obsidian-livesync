import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/models/fileaccess.type";
import type { IConversionAdapter } from "@lib/serviceModules/adapters";
import type { TFile, TFolder } from "obsidian";
/**
 * Conversion adapter implementation for Obsidian
 */
export declare class ObsidianConversionAdapter implements IConversionAdapter<TFile, TFolder> {
    nativeFileToUXFileInfoStub(file: TFile): UXFileInfoStub;
    nativeFolderToUXFolder(folder: TFolder): UXFolderInfo;
}
