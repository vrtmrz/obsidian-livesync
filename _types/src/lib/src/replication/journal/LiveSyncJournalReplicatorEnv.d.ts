import type { IServiceHub } from "@lib/services/base/IService";
import type { LiveSyncReplicatorEnv } from "@lib/replication/LiveSyncAbstractReplicator";
export interface LiveSyncJournalReplicatorEnv extends LiveSyncReplicatorEnv {
    services: IServiceHub;
}
