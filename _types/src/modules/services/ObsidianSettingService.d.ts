// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ObsidianLiveSyncSettings } from "@lib/common/types";
import { SettingService, type SettingServiceDependencies } from "@lib/services/base/SettingService";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
export declare class ObsidianSettingService<T extends ObsidianServiceContext> extends SettingService<T> {
    constructor(context: T, dependencies: SettingServiceDependencies);
    protected setItem(key: string, value: string): void;
    protected getItem(key: string): string;
    protected deleteItem(key: string): void;
    protected saveData(data: ObsidianLiveSyncSettings): Promise<void>;
    protected loadData(): Promise<ObsidianLiveSyncSettings | undefined>;
}
