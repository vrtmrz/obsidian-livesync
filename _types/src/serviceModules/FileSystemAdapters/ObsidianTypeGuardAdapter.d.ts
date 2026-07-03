// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ITypeGuardAdapter } from "@lib/serviceModules/adapters";
import { TFile, TFolder } from "obsidian";
/**
 * Type guard adapter implementation for Obsidian
 */
export declare class ObsidianTypeGuardAdapter implements ITypeGuardAdapter<TFile, TFolder> {
    isFile(file: unknown): file is TFile;
    isFolder(item: unknown): item is TFolder;
}
