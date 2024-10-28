import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";
import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";

export class ModulePouchDB extends AbstractModule implements ICoreModule {
    $$createPouchDBInstance<T extends object>(name?: string, options?: PouchDB.Configuration.DatabaseConfiguration): PouchDB.Database<T> {
        const optionPass = options ?? {};
        if (this.settings.useIndexedDBAdapter) {
            optionPass.adapter = "indexeddb";
            //@ts-ignore :missing def
            optionPass.purged_infos_limit = 1;
            return new PouchDB(name + "-indexeddb", optionPass);
        }
        return new PouchDB(name, optionPass);
    }
}