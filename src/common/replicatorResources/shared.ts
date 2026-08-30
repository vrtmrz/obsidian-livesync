import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

/**
 * Closeable surface of a concrete Replicator owned by one private resource.
 *
 * It deliberately exposes no active-provider controls: the resource may use
 * the helper for one bounded operation, then must dispose it without
 * publishing or replacing the active Replicator.
 */
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
