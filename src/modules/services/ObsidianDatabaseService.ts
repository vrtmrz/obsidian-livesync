import { initializeStores } from "@/common/stores";

// import { InjectableDatabaseService } from "@/lib/src/services/implements/injectable/InjectableDatabaseService";
import type { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";
import { DatabaseService, type DatabaseServiceDependencies } from "@lib/services/base/DatabaseService.ts";

export class ObsidianDatabaseService<T extends ObsidianServiceContext> extends DatabaseService<T> {
    private __onOpenDatabase(vaultName: string) {
        initializeStores(vaultName);
        return Promise.resolve(true);
    }
    constructor(context: T, dependencies: DatabaseServiceDependencies) {
        super(context, dependencies);
        this.onOpenDatabase.addHandler(this.__onOpenDatabase.bind(this));
    }
}
