import { eventHub, EVENT_REQUEST_OPEN_P2P } from "@/common/events";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type UseP2PReplicatorResult } from "@/lib/src/replication/trystero/UseP2PReplicatorResult";
import { P2PLogCollector } from "@/lib/src/replication/trystero/P2PLogCollector";
import { P2PReplicatorPaneView, VIEW_TYPE_P2P } from "@/features/P2PSync/P2PReplicator/P2PReplicatorPaneView";
import type { LiveSyncCore } from "@/main";

/**
 * ServiceFeature: P2P Replicator lifecycle management.
 * Binds a LiveSyncTrysteroReplicator to the host's lifecycle events,
 * following the same middleware style as useOfflineScanner.
 *
 * @param viewTypeAndFactory  Optional [viewType, factory] pair for registering the P2P pane view.
 *                            When provided, also registers commands and ribbon icon via services.API.
 */

export function useP2PReplicatorUI(
    host: NecessaryServices<
        | "API"
        | "appLifecycle"
        | "setting"
        | "vault"
        | "database"
        | "databaseEvents"
        | "keyValueDB"
        | "replication"
        | "config"
        | "UI"
        | "replicator",
        never
    >,
    core: LiveSyncCore,
    replicator: UseP2PReplicatorResult
) {
    // const env: LiveSyncTrysteroReplicatorEnv = { services: host.services as any };
    const getReplicator = () => replicator.replicator;
    const p2pLogCollector = new P2PLogCollector();
    const storeP2PStatusLine = reactiveSource("");
    p2pLogCollector.p2pReplicationLine.onChanged((line) => {
        storeP2PStatusLine.value = line.value;
    });

    // Register view, commands and ribbon if a view factory is provided
    const viewType = VIEW_TYPE_P2P;
    const factory = (leaf: any) => {
        return new P2PReplicatorPaneView(leaf, core, {
            replicator: getReplicator(),
            p2pLogCollector,
            storeP2PStatusLine,
        });
    };
    const openPane = () => host.services.API.showWindow(viewType);
    host.services.API.registerWindow(viewType, factory);

    host.services.appLifecycle.onInitialise.addHandler(() => {
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P, () => {
            void openPane();
        });

        host.services.API.addCommand({
            id: "open-p2p-replicator",
            name: "P2P Sync : Open P2P Replicator",
            callback: () => {
                void openPane();
            },
        });

        host.services.API.addRibbonIcon("waypoints", "P2P Replicator", () => {
            void openPane();
        })?.addClass?.("livesync-ribbon-replicate-p2p");

        return Promise.resolve(true);
    });
    return { replicator: getReplicator(), p2pLogCollector, storeP2PStatusLine };
}
