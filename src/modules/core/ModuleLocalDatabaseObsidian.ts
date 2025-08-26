import { $msg } from "../../lib/src/common/i18n";
import { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import { initializeStores } from "../../common/stores.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";
import { LiveSyncManagers } from "../../lib/src/managers/LiveSyncManagers.ts";

export class ModuleLocalDatabaseObsidian extends AbstractModule implements ICoreModule {
    $everyOnloadStart(): Promise<boolean> {
        return Promise.resolve(true);
    }
    async $$openDatabase(): Promise<boolean> {
        if (this.localDatabase != null) {
            await this.localDatabase.close();
        }
        const vaultName = this.core.$$getVaultName();
        this._log($msg("moduleLocalDatabase.logWaitingForReady"));
        const getDB = () => this.core.localDatabase.localDatabase;
        const getSettings = () => this.core.settings;
        this.core.managers = new LiveSyncManagers({
            get database() {
                return getDB();
            },
            getActiveReplicator: () => this.core.replicator,
            id2path: this.core.$$id2path.bind(this.core),
            path2id: this.core.$$path2id.bind(this.core),
            get settings() {
                return getSettings();
            },
        });
        this.core.localDatabase = new LiveSyncLocalDB(vaultName, this.core);

        initializeStores(vaultName);
        return await this.localDatabase.initializeDatabase();
    }

    $$isDatabaseReady(): boolean {
        return this.localDatabase != null && this.localDatabase.isReady;
    }
}
