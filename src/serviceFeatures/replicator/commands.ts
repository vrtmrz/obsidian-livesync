import type { NecessaryServices } from "@lib/interfaces/ServiceModule.ts";

export type ReplicatorFeatureHost = NecessaryServices<"API" | "replication" | "replicator", never>;

export function registerReplicatorCommands(host: ReplicatorFeatureHost) {
    host.services.API.addCommand({
        id: "livesync-replicate",
        name: "Replicate now",
        callback: async () => {
            await host.services.replication.replicate();
        },
    });

    host.services.API.addCommand({
        id: "livesync-abortsync",
        name: "Abort synchronization immediately",
        callback: () => {
            host.services.replicator.getActiveReplicator()?.terminateSync();
        },
    });
}
