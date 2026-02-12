import { $msg } from "../../lib/src/common/i18n";
import { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import { initializeStores } from "../../common/stores.ts";
import { AbstractModule } from "../AbstractModule.ts";
import { LiveSyncManagers } from "../../lib/src/managers/LiveSyncManagers.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleLocalDatabaseObsidian extends AbstractModule {
    _everyOnloadStart(): Promise<boolean> {
        return Promise.resolve(true);
    }
    private async _openDatabase(): Promise<boolean> {
        if (this.localDatabase != null) {
            await this.localDatabase.close();
        }
        const vaultName = this.services.vault.getVaultName();
        this._log($msg("moduleLocalDatabase.logWaitingForReady"));
        const getDB = () => this.core.localDatabase.localDatabase;
        const getSettings = () => this.core.settings;
        this.core.managers = new LiveSyncManagers({
            get database() {
                return getDB();
            },
            getActiveReplicator: () => this.core.replicator,
            id2path: this.services.path.id2path.bind(this.services.path),
            // path2id: this.core.$$path2id.bind(this.core),
            path2id: this.services.path.path2id.bind(this.services.path),
            get settings() {
                return getSettings();
            },
        });
        this.core.localDatabase = new LiveSyncLocalDB(vaultName, this.core);

        initializeStores(vaultName);
        return await this.localDatabase.initializeDatabase();
    }

    _isDatabaseReady(): boolean {
        return this.localDatabase != null && this.localDatabase.isReady;
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.database.isDatabaseReady.setHandler(this._isDatabaseReady.bind(this));
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.database.openDatabase.setHandler(this._openDatabase.bind(this));
    }
}
