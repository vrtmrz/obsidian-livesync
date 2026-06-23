import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/types";
import type { IConversionAdapter } from "@lib/serviceModules/adapters";
import { TFileToUXFileInfoStub, TFolderToUXFileInfoStub } from "@/modules/coreObsidian/storageLib/utilObsidian";
import type { TFile, TFolder } from "obsidian";

/**
 * Conversion adapter implementation for Obsidian
 */

export class ObsidianConversionAdapter implements IConversionAdapter<TFile, TFolder> {
    nativeFileToUXFileInfoStub(file: TFile): UXFileInfoStub {
        return TFileToUXFileInfoStub(file);
    }

    nativeFolderToUXFolder(folder: TFolder): UXFolderInfo {
        return TFolderToUXFileInfoStub(folder);
    }
}
