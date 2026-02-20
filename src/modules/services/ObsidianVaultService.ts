import { getPathFromTFile } from "@/common/utils";
import { InjectableVaultService } from "@/lib/src/services/implements/injectable/InjectableVaultService";
import type { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";
import type { FilePath } from "@/lib/src/common/types";

declare module "obsidian" {
    interface DataAdapter {
        insensitive?: boolean;
    }
}

// InjectableVaultService
export class ObsidianVaultService extends InjectableVaultService<ObsidianServiceContext> {
    override vaultName(): string {
        return this.context.app.vault.getName();
    }
    getActiveFilePath(): FilePath | undefined {
        const file = this.context.app.workspace.getActiveFile();
        if (file) {
            return getPathFromTFile(file);
        }
        return undefined;
    }
    isStorageInsensitive(): boolean {
        return this.context.app.vault.adapter.insensitive ?? true;
    }

    override shouldCheckCaseInsensitively(): boolean {
        // If the storage is insensitive, always return false, that because no need to check again.
        if (this.isStorageInsensitive()) return false;
        return super.shouldCheckCaseInsensitively(); // Check the setting
    }
}
