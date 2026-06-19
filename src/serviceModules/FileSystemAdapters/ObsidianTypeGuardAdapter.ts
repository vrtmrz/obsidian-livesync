import type { ITypeGuardAdapter } from "@lib/serviceModules/adapters";
import { TFile, TFolder } from "obsidian";

/**
 * Type guard adapter implementation for Obsidian
 */

export class ObsidianTypeGuardAdapter implements ITypeGuardAdapter<TFile, TFolder> {
    isFile(file: unknown): file is TFile {
        return file instanceof TFile;
    }

    isFolder(item: unknown): item is TFolder {
        return item instanceof TFolder;
    }
}
