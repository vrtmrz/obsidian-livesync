// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LOG_LEVEL } from "octagonal-wheels/common/logger";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { P2PSyncSetting, EntryDoc } from "@lib/common/types";
import type { Confirm } from "@lib/interfaces/Confirm";
import type { InjectableServiceHub } from "@lib/services/InjectableServices";
export interface P2PReplicatorBase {
    storeP2PStatusLine: ReactiveSource<string>;
    settings: P2PSyncSetting;
    _log(msg: unknown, level?: LOG_LEVEL): void;
    _notice(msg: unknown, key?: string): void;
    getSettings(): P2PSyncSetting;
    getDB: () => PouchDB.Database<EntryDoc>;
    confirm: Confirm;
    simpleStore(): SimpleStore<unknown>;
    handleReplicatedDocuments(docs: EntryDoc[]): Promise<boolean>;
    init(): Promise<this>;
    services: InjectableServiceHub;
}
