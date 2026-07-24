import { eventHub, EVENT_REQUEST_OPEN_P2P } from "@/common/events";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { type UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult";
import { P2PLogCollector } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PLogCollector";
import {
    P2PServerStatusPaneView,
    VIEW_TYPE_P2P_SERVER_STATUS,
} from "@/features/P2PSync/P2PReplicator/P2PServerStatusPaneView";
import type { LiveSyncCore } from "@/main";
import type { WorkspaceLeaf } from "@/deps";
import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";

export const LEGACY_VIEW_TYPE_P2P = "p2p-replicator";

class LegacyP2PStatusPaneView extends P2PServerStatusPaneView {
    override getViewType() {
        return LEGACY_VIEW_TYPE_P2P;
    }
}

export function hasP2PConfiguration(settings: Partial<ObsidianLiveSyncSettings>): boolean {
    if (
        settings.remoteType === REMOTE_P2P ||
        settings.P2P_Enabled === true ||
        (settings.P2P_roomID ?? "").trim() !== "" ||
        (settings.P2P_passphrase ?? "").trim() !== ""
    ) {
        return true;
    }
    return Object.values(settings.remoteConfigurations ?? {}).some((configuration) => {
        try {
            return ConnectionStringParser.parse(configuration.uri).type === "p2p";
        } catch {
            return false;
        }
    });
}

/**
 * Obsidian-specific P2P views, commands, status collection, and ribbon wiring.
 * Replicator ownership and lifecycle remain in Commonlib's
 * `useP2PReplicatorFeature`; this feature only consumes its current result.
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
        addCommand: (command: {
            id: string;
            name: string;
            callback?: () => void;
            checkCallback?: (checking: boolean) => boolean | void;
        }) => unknown;
        addRibbonIcon: (
            icon: string,
            title: string,
            callback: () => void
        ) => { addClass?: (name: string) => unknown; remove?: () => void } | undefined;
    };

    // const env: LiveSyncTrysteroReplicatorEnv = { services: host.services as any };
    const getReplicator = () => replicator.replicator;
    const p2pLogCollector = new P2PLogCollector(host.services.context.events);
    const storeP2PStatusLine = reactiveSource("");
    p2pLogCollector.p2pReplicationLine.onChanged((line) => {
        storeP2PStatusLine.value = line.value;
    });
    const p2pParams = {
        get replicator() {
            return getReplicator();
        },
        p2pLogCollector,
        storeP2PStatusLine,
    };

    const statusFactory = (leaf: WorkspaceLeaf) => {
        return new P2PServerStatusPaneView(leaf, core, p2pParams);
    };
    const legacyStatusFactory = (leaf: WorkspaceLeaf) => {
        return new LegacyP2PStatusPaneView(leaf, core, p2pParams);
    };
    const openStatusPane = () => {
        if (api.showWindowOnRight) {
            return api.showWindowOnRight(VIEW_TYPE_P2P_SERVER_STATUS);
        }
        return api.showWindow(VIEW_TYPE_P2P_SERVER_STATUS);
    };
    const runOpenReplication = () => {
        const activeReplicator = replicator.replicator;
        if (!activeReplicator) return;
        const settings = host.services.setting.currentSettings();
        void host.services.replicator.runFiniteReplicationActivity(
            () => activeReplicator.openReplication(settings, false, true, false),
            { label: "replication" }
        );
    };
    // Keep the retired view type registered only long enough to restore an
    // existing workspace leaf with the current status UI. Layout-ready
    // migration below rewrites it to the current type without opening a leaf.
    api.registerWindow(LEGACY_VIEW_TYPE_P2P, legacyStatusFactory);
    api.registerWindow(VIEW_TYPE_P2P_SERVER_STATUS, statusFactory);

    let ribbonElement: { addClass?: (name: string) => unknown; remove?: () => void } | undefined;
    const updateRibbon = (settings: Partial<ObsidianLiveSyncSettings>) => {
        if (hasP2PConfiguration(settings)) {
            if (ribbonElement) return;
            ribbonElement = api.addRibbonIcon("waypoints", "P2P Status", () => {
                void openStatusPane();
            });
            ribbonElement?.addClass?.("livesync-ribbon-p2p-server-status");
            return;
        }
        ribbonElement?.remove?.();
        ribbonElement = undefined;
    };

    // Settings are loaded after onInitialise. Reading them from the earlier
    // phase aborts the plug-in lifecycle before the local database can open.
    host.services.appLifecycle.onSettingLoaded.addHandler(() => {
        updateRibbon(host.services.setting.currentSettings());
        return Promise.resolve(true);
    });

    host.services.appLifecycle.onInitialise.addHandler(() => {
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P, () => {
            void openStatusPane();
        });

        api.addCommand({
            id: "open-p2p-server-status",
            name: "P2P Sync : Open P2P Status",
            checkCallback: (checking) => {
                if (!hasP2PConfiguration(host.services.setting.currentSettings())) return false;
                if (!checking) {
                    void openStatusPane();
                }
                return true;
            },
        });
        host.services.API.addCommand({
            id: "replicate-now-by-p2p-default-peer",
            name: "Replicate P2P to default peer",
            checkCallback: (isChecking: boolean) => {
                const settings = host.services.setting.currentSettings();
                const isAvailable =
                    hasP2PConfiguration(settings) &&
                    settings.remoteType !== REMOTE_P2P &&
                    (replicator.replicator?.server?.isServing ?? false);
                if (!isAvailable) return false;
                if (!isChecking) {
                    runOpenReplication();
                }
                return true;
            },
        });
        host.services.API.addCommand({
            id: "replicate-now-by-p2p",
            name: "Replicate now by P2P",
            checkCallback: (isChecking: boolean) => {
                const settings = host.services.setting.currentSettings();
                const isAvailable =
                    hasP2PConfiguration(settings) &&
                    settings.remoteType !== REMOTE_P2P &&
                    (replicator.replicator?.server?.isServing ?? false);
                if (!isAvailable) return false;
                if (!isChecking) {
                    runOpenReplication();
                }
                return true;
            },
        });

        host.services.API.addCommand({
            id: "p2p-sync-targets",
            name: "P2P: Sync with targets",
            checkCallback: (isChecking: boolean) => {
                const isAvailable =
                    hasP2PConfiguration(host.services.setting.currentSettings()) &&
                    (replicator.replicator?.server?.isServing ?? false);
                if (!isAvailable) return false;
                if (!isChecking) {
                    void replicator.replicator?.replicateFromCommand(true);
                }
                return true;
            },
        });

        host.services.setting.onSettingSaved?.addHandler((settings) => {
            updateRibbon(settings);
            return Promise.resolve(true);
        });

        return Promise.resolve(true);
    });

    host.services.appLifecycle.onLayoutReady.addHandler(async () => {
        const workspace = (
            host.services.context as {
                app?: {
                    workspace?: {
                        getLeavesOfType(type: string): WorkspaceLeaf[];
                    };
                };
            }
        ).app?.workspace;
        if (!workspace) {
            return true;
        }
        const legacyLeaves = workspace.getLeavesOfType(LEGACY_VIEW_TYPE_P2P);
        await Promise.all(
            legacyLeaves.map((leaf) =>
                leaf.setViewState({
                    type: VIEW_TYPE_P2P_SERVER_STATUS,
                    active: false,
                })
            )
        );
        return true;
    });
    return p2pParams;
}
