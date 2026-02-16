import { initializeStores } from "@/common/stores";

import { InjectableDatabaseService } from "@/lib/src/services/implements/injectable/InjectableDatabaseService";
import type { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";

export class ObsidianDatabaseService extends InjectableDatabaseService<ObsidianServiceContext> {
    override onOpenDatabase(vaultName: string): Promise<void> {
        initializeStores(vaultName);
        return Promise.resolve();
    }
}
