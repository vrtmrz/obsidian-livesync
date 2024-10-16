import { $f } from "../../lib/src/common/i18n";
import { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import { initializeStores } from "../../common/stores.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleLocalDatabaseObsidian extends AbstractModule implements ICoreModule {

    $everyOnloadStart(): Promise<boolean> {
        return Promise.resolve(true);
    }
    async $$openDatabase(): Promise<boolean> {
        if (this.localDatabase != null) {
            await this.localDatabase.close();
        }
        const vaultName = this.core.$$getVaultName();
        this._log($f`Waiting for ready...`);
        this.core.localDatabase = new LiveSyncLocalDB(vaultName, this.core);
        initializeStores(vaultName);
        return await this.localDatabase.initializeDatabase();
    }

}