import { InjectableVaultService } from "@lib/services/implements/injectable/InjectableVaultService";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import type { FilePath } from "@lib/common/models/db.type";
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
