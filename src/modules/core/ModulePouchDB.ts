import { AbstractModule } from "../AbstractModule";
import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import type { LiveSyncCore } from "../../main";
import { ExtraSuffixIndexedDB } from "../../lib/src/common/types";

export class ModulePouchDB extends AbstractModule {
    _createPouchDBInstance<T extends object>(
        name?: string,
        options?: PouchDB.Configuration.DatabaseConfiguration
    ): PouchDB.Database<T> {
        const optionPass = options ?? {};
        if (this.settings.useIndexedDBAdapter) {
            optionPass.adapter = "indexeddb";
            //@ts-ignore :missing def
            optionPass.purged_infos_limit = 1;
            return new PouchDB(name + ExtraSuffixIndexedDB, optionPass);
        }
        return new PouchDB(name, optionPass);
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.database.createPouchDBInstance.setHandler(this._createPouchDBInstance.bind(this));
    }
}
