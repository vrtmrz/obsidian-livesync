import type { InjectableServiceHub } from "../../lib/src/services/InjectableServices.ts";
import type { LiveSyncCore } from "../../main.ts";
import { AbstractModule } from "../AbstractModule.ts";

export class ModuleRemoteGovernor extends AbstractModule {
    private async _markRemoteLocked(lockByClean: boolean = false): Promise<void> {
        return await this.core.replicator.markRemoteLocked(this.settings, true, lockByClean);
    }

    private async _markRemoteUnlocked(): Promise<void> {
        return await this.core.replicator.markRemoteLocked(this.settings, false, false);
    }

    private async _markRemoteResolved(): Promise<void> {
        return await this.core.replicator.markRemoteResolved(this.settings);
    }
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.remote.markLocked.setHandler(this._markRemoteLocked.bind(this));
        services.remote.markUnlocked.setHandler(this._markRemoteUnlocked.bind(this));
        services.remote.markResolved.setHandler(this._markRemoteResolved.bind(this));
    }
}
