import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleRemoteGovernor extends AbstractModule implements ICoreModule {
    async $$markRemoteLocked(lockByClean: boolean = false): Promise<void> {
        return await this.core.replicator.markRemoteLocked(this.settings, true, lockByClean);
    }

    async $$markRemoteUnlocked(): Promise<void> {
        return await this.core.replicator.markRemoteLocked(this.settings, false, false);
    }

    async $$markRemoteResolved(): Promise<void> {
        return await this.core.replicator.markRemoteResolved(this.settings);
    }
}