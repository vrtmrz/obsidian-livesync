// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { UXDataWriteOptions } from "@lib/common/types";
import type { IStorageAdapter } from "@lib/serviceModules/adapters";
import type { Stat, App } from "obsidian";
/**
 * Storage adapter implementation for Obsidian
 */
export declare class ObsidianStorageAdapter implements IStorageAdapter<Stat> {
    private app;
    constructor(app: App);
    exists(path: string): Promise<boolean>;
    trystat(path: string): Promise<Stat | null>;
    stat(path: string): Promise<Stat | null>;
    mkdir(path: string): Promise<void>;
    remove(path: string): Promise<void>;
    read(path: string): Promise<string>;
    readBinary(path: string): Promise<ArrayBuffer>;
    write(path: string, data: string, options?: UXDataWriteOptions): Promise<void>;
    writeBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void>;
    append(path: string, data: string, options?: UXDataWriteOptions): Promise<void>;
    list(basePath: string): Promise<{
        files: string[];
        folders: string[];
    }>;
}
