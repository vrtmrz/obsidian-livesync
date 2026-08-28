import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

export interface ResourceReplicator {
    closeReplication(): void | Promise<void>;
}

/** Create one idempotent asynchronous disposer for a private Replicator. */
export function createReplicatorDisposer(replicator: ResourceReplicator): () => Promise<void> {
    let disposal: Promise<void> | undefined;
    return () => {
        if (disposal === undefined) {
            disposal = Promise.resolve().then(() => replicator.closeReplication());
        }
        return disposal;
    };
}

/** Fence a finite resource from later edits to its source settings object. */
export function snapshotRemoteSettings(setting: RemoteDBSettings): RemoteDBSettings {
    return { ...setting };
}
