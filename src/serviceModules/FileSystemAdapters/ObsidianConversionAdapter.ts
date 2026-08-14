import type { UXFileInfoStub, UXFolderInfo } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
import type { IConversionAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters.js";
import { TFileToUXFileInfoStub, TFolderToUXFileInfoStub } from "@/modules/coreObsidian/storageLib/utilObsidian.js";
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
