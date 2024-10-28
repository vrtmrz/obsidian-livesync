import { delay, yieldMicrotask } from "octagonal-wheels/promises";
import { OpenKeyValueDatabase } from "../../common/KeyValueDB.ts";
import type { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleKeyValueDB extends AbstractModule implements ICoreModule {

    tryCloseKvDB() {
        try {
            this.core.kvDB?.close();
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
            this.tryCloseKvDB();
            await delay(10);
            await yieldMicrotask();
            this.core.kvDB = await OpenKeyValueDatabase(this.core.$$getVaultName() + "-livesync-kv");
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
    $allOnDBUnload(db: LiveSyncLocalDB): void {
        if (this.core.kvDB) this.core.kvDB.close();
    }
    $allOnDBClose(db: LiveSyncLocalDB): void {
        if (this.core.kvDB) this.core.kvDB.close();
    }

    async $everyOnloadAfterLoadSettings(): Promise<boolean> {
        if (!await this.openKeyValueDB()) {
            return false;
        }
        this.core.simpleStore = this.core.$$getSimpleStore<any>("os");
        return Promise.resolve(true);
    }
    $$getSimpleStore<T>(kind: string) {
        const prefix = `${kind}-`;
        return {
            get: async (key: string): Promise<T> => {
                return await this.core.kvDB.get(`${prefix}${key}`);
            },
            set: async (key: string, value: any): Promise<void> => {
                await this.core.kvDB.set(`${prefix}${key}`, value);
            },
            delete: async (key: string): Promise<void> => {
                await this.core.kvDB.del(`${prefix}${key}`);
            },
            keys: async (from: string | undefined, to: string | undefined, count?: number | undefined): Promise<string[]> => {
                const ret = this.core.kvDB.keys(IDBKeyRange.bound(`${prefix}${from || ""}`, `${prefix}${to || ""}`), count);
                return (await ret).map(e => e.toString()).filter(e => e.startsWith(prefix)).map(e => e.substring(prefix.length));
            }
        }
    }
    $everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return this.openKeyValueDB();
    }

    async $everyOnResetDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        try {
            const kvDBKey = "queued-files"
            await this.core.kvDB.del(kvDBKey);
            // localStorage.removeItem(lsKey);
            await this.core.kvDB.destroy();
            await yieldMicrotask();
            this.core.kvDB = await OpenKeyValueDatabase(this.core.$$getVaultName() + "-livesync-kv");
            await delay(100);
        } catch (e) {
            this.core.kvDB = undefined!;
            this._log("Failed to reset KeyValueDB", LOG_LEVEL_NOTICE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }
}