import { eventHub, EVENT_REQUEST_OPEN_P2P } from "@/common/events";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type UseP2PReplicatorResult } from "@/lib/src/replication/trystero/UseP2PReplicatorResult";
import { P2PLogCollector } from "@/lib/src/replication/trystero/P2PLogCollector";
import { P2PReplicatorPaneView, VIEW_TYPE_P2P } from "@/features/P2PSync/P2PReplicator/P2PReplicatorPaneView";
import {
    P2PServerStatusPaneView,
    VIEW_TYPE_P2P_SERVER_STATUS,
} from "@/features/P2PSync/P2PReplicator/P2PServerStatusPaneView";
import type { LiveSyncCore } from "@/main";
import type { WorkspaceLeaf } from "@/deps";
import { REMOTE_P2P } from "@lib/common/models/setting.const";

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
    const api = host.services.API as {
        showWindow: (type: string) => Promise<void>;
        showWindowOnRight?: (type: string) => Promise<void>;
        registerWindow: (type: string, factory: (leaf: WorkspaceLeaf) => unknown) => void;
        addCommand: (command: { id: string; name: string; callback: () => void }) => unknown;
        addRibbonIcon: (
            icon: string,
            title: string,
            callback: () => void
        ) => { addClass?: (name: string) => unknown } | undefined;
        getPlatform: () => string;
    };

    // const env: LiveSyncTrysteroReplicatorEnv = { services: host.services as any };
    const getReplicator = () => replicator.replicator;
    const p2pLogCollector = new P2PLogCollector();
    const storeP2PStatusLine = reactiveSource("");
    p2pLogCollector.p2pReplicationLine.onChanged((line) => {
        storeP2PStatusLine.value = line.value;
    });

    // Register view, commands and ribbon if a view factory is provided
    const viewType = VIEW_TYPE_P2P;
    const factory = (leaf: WorkspaceLeaf) => {
        return new P2PReplicatorPaneView(leaf, core, {
            replicator: getReplicator(),
            p2pLogCollector,
            storeP2PStatusLine,
        });
    };
    const statusFactory = (leaf: WorkspaceLeaf) => {
        return new P2PServerStatusPaneView(leaf, core, {
            replicator: getReplicator(),
            p2pLogCollector,
            storeP2PStatusLine,
        });
    };
    const openPane = () => api.showWindow(viewType);
    const openStatusPane = () => {
        if (api.showWindowOnRight) {
            return api.showWindowOnRight(VIEW_TYPE_P2P_SERVER_STATUS);
        }
        return api.showWindow(VIEW_TYPE_P2P_SERVER_STATUS);
    };
    api.registerWindow(viewType, factory);
    api.registerWindow(VIEW_TYPE_P2P_SERVER_STATUS, statusFactory);

    host.services.appLifecycle.onInitialise.addHandler(() => {
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P, () => {
            void openPane();
        });

        api.addCommand({
            id: "open-p2p-replicator",
            name: "P2P Sync : Open P2P Replicator (Old UI)",
            callback: () => {
                void openPane();
            },
        });

        api.addCommand({
            id: "open-p2p-server-status",
            name: "P2P Sync : Open P2P Status",
            callback: () => {
                void openStatusPane();
            },
        });
        host.services.API.addCommand({
            id: "replicate-now-by-p2p-default-peer",
            name: "Replicate P2P to default peer",
            checkCallback: (isChecking: boolean) => {
                const settings = host.services.setting.currentSettings();
                if (isChecking) {
                    if (settings.remoteType == REMOTE_P2P) return false;
                    return replicator.replicator?.server?.isServing ?? false;
                }
                void replicator.replicator?.openReplication(settings, false, true, false);
            },
        });
        host.services.API.addCommand({
            id: "replicate-now-by-p2p",
            name: "Replicate now by P2P",
            checkCallback: (isChecking: boolean) => {
                const settings = host.services.setting.currentSettings();
                if (isChecking) {
                    if (settings.remoteType == REMOTE_P2P) return false;
                    return replicator.replicator?.server?.isServing ?? false;
                }
                void replicator.replicator?.openReplication(settings, false, true, false);
            },
        });

        host.services.API.addCommand({
            id: "p2p-sync-targets",
            name: "P2P: Sync with targets",
            checkCallback: (isChecking: boolean) => {
                if (isChecking) {
                    return replicator.replicator?.server?.isServing ?? false;
                }
                void replicator.replicator?.replicateFromCommand(true);
            },
        });

        // api.addRibbonIcon("waypoints", "P2P Replicator", () => {
        //     void openPane();
        // })?.addClass?.("livesync-ribbon-replicate-p2p");

        api.addRibbonIcon("waypoints", "P2P Status", () => {
            void openStatusPane();
        })?.addClass?.("livesync-ribbon-p2p-server-status");

        return Promise.resolve(true);
    });

    host.services.appLifecycle.onLayoutReady.addHandler(() => {
        if (api.getPlatform() !== "obsidian") {
            return Promise.resolve(true);
        }
        if (api.showWindowOnRight) {
            void api.showWindowOnRight(VIEW_TYPE_P2P_SERVER_STATUS);
        } else {
            void api.showWindow(VIEW_TYPE_P2P_SERVER_STATUS);
        }
        return Promise.resolve(true);
    });
    return { replicator: getReplicator(), p2pLogCollector, storeP2PStatusLine };
}
