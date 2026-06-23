// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: f20eb19
import { InjectableVaultService } from "@lib/services/implements/injectable/InjectableVaultService";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import type { FilePath } from "@lib/common/types";
declare module "obsidian" {
    interface DataAdapter {
        insensitive?: boolean;
    }
}
export declare class ObsidianVaultService extends InjectableVaultService<ObsidianServiceContext> {
    vaultName(): string;
    getActiveFilePath(): FilePath | undefined;
    isStorageInsensitive(): boolean;
    shouldCheckCaseInsensitively(): boolean;
    isValidPath(path: string): boolean;
}
