import { delay, yieldMicrotask } from "octagonal-wheels/promises";
import { OpenKeyValueDatabase } from "../../common/KeyValueDB.ts";
import type { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractModule } from "../AbstractModule.ts";
import type { LiveSyncCore } from "../../main.ts";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { InjectableServiceHub } from "@/lib/src/services/InjectableServices.ts";
import type { ObsidianDatabaseService } from "../services/ObsidianServices.ts";

export class ModuleKeyValueDB extends AbstractModule {
    async tryCloseKvDB() {
        try {
            await this.core.kvDB?.close();
            return true;
        } catch (e) {
            this._log("Failed to close KeyValueDB", LOG_LEVEL_VERBOSE);
            this._log(e);
            return false;
        }
    }
    async openKeyValueDB(): Promise<boolean> {
        await delay(10);
        try {
            await this.tryCloseKvDB();
            await delay(10);
            await yieldMicrotask();
            this.core.kvDB = await OpenKeyValueDatabase(this.services.vault.getVaultName() + "-livesync-kv");
            await yieldMicrotask();
            await delay(100);
        } catch (e) {
            this.core.kvDB = undefined!;
            this._log("Failed to open KeyValueDB", LOG_LEVEL_NOTICE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }
    async _onDBUnload(db: LiveSyncLocalDB) {
        if (this.core.kvDB) await this.core.kvDB.close();
        return Promise.resolve(true);
    }
    async _onDBClose(db: LiveSyncLocalDB) {
        if (this.core.kvDB) await this.core.kvDB.close();
        return Promise.resolve(true);
    }

    private async _everyOnloadAfterLoadSettings(): Promise<boolean> {
        if (!(await this.openKeyValueDB())) {
            return false;
        }
        this.core.simpleStore = this.services.database.openSimpleStore<any>("os");
        return Promise.resolve(true);
    }
    _getSimpleStore<T>(kind: string) {
        const getDB = () => this.core.kvDB;
        const prefix = `${kind}-`;
        return {
            get: async (key: string): Promise<T> => {
                return await getDB().get(`${prefix}${key}`);
            },
            set: async (key: string, value: any): Promise<void> => {
                await getDB().set(`${prefix}${key}`, value);
            },
            delete: async (key: string): Promise<void> => {
                await getDB().del(`${prefix}${key}`);
            },
            keys: async (
                from: string | undefined,
                to: string | undefined,
                count?: number | undefined
            ): Promise<string[]> => {
                const ret = await getDB().keys(
                    IDBKeyRange.bound(`${prefix}${from || ""}`, `${prefix}${to || ""}`),
                    count
                );
                return ret
                    .map((e) => e.toString())
                    .filter((e) => e.startsWith(prefix))
                    .map((e) => e.substring(prefix.length));
            },
            db: Promise.resolve(getDB()),
        } satisfies SimpleStore<T>;
    }
    _everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return this.openKeyValueDB();
    }

    async _everyOnResetDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        try {
            const kvDBKey = "queued-files";
            await this.core.kvDB.del(kvDBKey);
            // localStorage.removeItem(lsKey);
            await this.core.kvDB.destroy();
            await yieldMicrotask();
            this.core.kvDB = await OpenKeyValueDatabase(this.services.vault.getVaultName() + "-livesync-kv");
            await delay(100);
        } catch (e) {
            this.core.kvDB = undefined!;
            this._log("Failed to reset KeyValueDB", LOG_LEVEL_NOTICE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.databaseEvents.onUnloadDatabase.addHandler(this._onDBUnload.bind(this));
        services.databaseEvents.onCloseDatabase.addHandler(this._onDBClose.bind(this));
        services.databaseEvents.onDatabaseInitialisation.addHandler(this._everyOnInitializeDatabase.bind(this));
        services.databaseEvents.onResetDatabase.addHandler(this._everyOnResetDatabase.bind(this));
        (services.database as ObsidianDatabaseService).openSimpleStore.setHandler(this._getSimpleStore.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
    }
}
