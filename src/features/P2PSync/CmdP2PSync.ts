import type { IObsidianModule } from "../../modules/AbstractObsidianModule";
import { P2PReplicatorPaneView, VIEW_TYPE_P2P } from "./P2PReplicator/P2PReplicatorPaneView.ts";
import { TrysteroReplicator } from "../../lib/src/replication/trystero/TrysteroReplicator.ts";
import {
    AutoAccepting,
    DEFAULT_SETTINGS,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    REMOTE_P2P,
    type EntryDoc,
    type RemoteDBSettings,
} from "../../lib/src/common/types.ts";
import { LiveSyncCommands } from "../LiveSyncCommands.ts";
import {
    LiveSyncTrysteroReplicator,
    setReplicatorFunc,
} from "../../lib/src/replication/trystero/LiveSyncTrysteroReplicator.ts";
import {
    EVENT_DATABASE_REBUILT,
    EVENT_PLUGIN_UNLOADED,
    EVENT_REQUEST_OPEN_P2P,
    eventHub,
} from "../../common/events.ts";
import {
    EVENT_ADVERTISEMENT_RECEIVED,
    EVENT_DEVICE_LEAVED,
    EVENT_P2P_REQUEST_FORCE_OPEN,
    EVENT_REQUEST_STATUS,
} from "../../lib/src/replication/trystero/TrysteroReplicatorP2PServer.ts";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator.ts";
import { Logger } from "octagonal-wheels/common/logger";
import { $msg } from "../../lib/src/common/i18n.ts";

export class P2PReplicator extends LiveSyncCommands implements IObsidianModule {
    $anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(new LiveSyncTrysteroReplicator(this.plugin));
        }
        return undefined!;
    }

    _replicatorInstance?: TrysteroReplicator;
    onunload(): void {
        setReplicatorFunc(() => undefined);
        void this.close();
    }

    onload(): void | Promise<void> {
        setReplicatorFunc(() => this._replicatorInstance);
        eventHub.onEvent(EVENT_ADVERTISEMENT_RECEIVED, (peerId) => this._replicatorInstance?.onNewPeer(peerId));
        eventHub.onEvent(EVENT_DEVICE_LEAVED, (info) => this._replicatorInstance?.onPeerLeaved(info));
        eventHub.onEvent(EVENT_REQUEST_STATUS, () => {
            this._replicatorInstance?.requestStatus();
        });
        eventHub.onEvent(EVENT_P2P_REQUEST_FORCE_OPEN, () => {
            void this.open();
        });
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P, () => {
            void this.openPane();
        });
        eventHub.onEvent(EVENT_DATABASE_REBUILT, async () => {
            await this.initialiseP2PReplicator();
        });
        eventHub.onEvent(EVENT_PLUGIN_UNLOADED, () => {
            void this.close();
        });
        // throw new Error("Method not implemented.");
    }
    async $everyOnInitializeDatabase(): Promise<boolean> {
        await this.initialiseP2PReplicator();
        return Promise.resolve(true);
    }

    async $allSuspendExtraSync() {
        this.plugin.settings.P2P_Enabled = false;
        this.plugin.settings.P2P_AutoAccepting = AutoAccepting.NONE;
        this.plugin.settings.P2P_AutoBroadcast = false;
        this.plugin.settings.P2P_AutoStart = false;
        this.plugin.settings.P2P_AutoSyncPeers = "";
        this.plugin.settings.P2P_AutoWatchPeers = "";
        return await Promise.resolve(true);
    }
    async $everyOnLoadStart() {
        return await Promise.resolve();
    }

    async openPane() {
        await this.plugin.$$showView(VIEW_TYPE_P2P);
    }

    async $everyOnloadStart(): Promise<boolean> {
        this.plugin.registerView(VIEW_TYPE_P2P, (leaf) => new P2PReplicatorPaneView(leaf, this.plugin));
        this.plugin.addCommand({
            id: "open-p2p-replicator",
            name: "P2P Sync : Open P2P Replicator",
            callback: async () => {
                await this.openPane();
            },
        });
        this.plugin.addCommand({
            id: "p2p-establish-connection",
            name: "P2P Sync : Connect to the Signalling Server",
            checkCallback: (isChecking) => {
                if (isChecking) {
                    return !(this._replicatorInstance?.server?.isServing ?? false);
                }
                void this.open();
            },
        });
        this.plugin.addCommand({
            id: "p2p-close-connection",
            name: "P2P Sync : Disconnect from the Signalling Server",
            checkCallback: (isChecking) => {
                if (isChecking) {
                    return this._replicatorInstance?.server?.isServing ?? false;
                }
                Logger(`Closing P2P Connection`, LOG_LEVEL_NOTICE);
                void this.close();
            },
        });
        this.plugin.addCommand({
            id: "replicate-now-by-p2p",
            name: "Replicate now by P2P",
            checkCallback: (isChecking) => {
                if (isChecking) {
                    if (this.settings.remoteType == REMOTE_P2P) return false;
                    if (!this._replicatorInstance?.server?.isServing) return false;
                    return true;
                }
                void this._replicatorInstance?.replicateFromCommand(false);
            },
        });
        this.plugin
            .addRibbonIcon("waypoints", "P2P Replicator", async () => {
                await this.openPane();
            })
            .addClass("livesync-ribbon-replicate-p2p");

        return await Promise.resolve(true);
    }
    $everyAfterResumeProcess(): Promise<boolean> {
        if (this.settings.P2P_Enabled && this.settings.P2P_AutoStart) {
            setTimeout(() => void this.open(), 100);
        }
        return Promise.resolve(true);
    }
    async open() {
        if (!this.settings.P2P_Enabled) {
            this._notice($msg("P2P.NotEnabled"));
            return;
        }

        if (!this._replicatorInstance) {
            await this.initialiseP2PReplicator();
        }
        await this._replicatorInstance?.open();
    }
    async close() {
        await this._replicatorInstance?.close();
        this._replicatorInstance = undefined;
    }
    getConfig(key: string) {
        const vaultName = this.plugin.$$getVaultName();
        const dbKey = `${vaultName}-${key}`;
        return localStorage.getItem(dbKey);
    }
    setConfig(key: string, value: string) {
        const vaultName = this.plugin.$$getVaultName();
        const dbKey = `${vaultName}-${key}`;
        localStorage.setItem(dbKey, value);
    }

    async initialiseP2PReplicator(): Promise<TrysteroReplicator> {
        const getPlugin = () => this.plugin;
        try {
            // const plugin = this.plugin;
            if (this._replicatorInstance) {
                await this._replicatorInstance.close();
                this._replicatorInstance = undefined;
            }

            if (!this.settings.P2P_AppID) {
                this.settings.P2P_AppID = DEFAULT_SETTINGS.P2P_AppID;
            }

            const initialDeviceName = this.getConfig("p2p_device_name") || this.plugin.$$getDeviceAndVaultName();
            const env = {
                get db() {
                    return getPlugin().localDatabase.localDatabase;
                },
                get confirm() {
                    return getPlugin().confirm;
                },
                get deviceName() {
                    return initialDeviceName;
                },
                platform: "wip",
                get settings() {
                    return getPlugin().settings;
                },
                async processReplicatedDocs(docs: EntryDoc[]): Promise<void> {
                    return await getPlugin().$$parseReplicationResult(
                        docs as PouchDB.Core.ExistingDocument<EntryDoc>[]
                    );
                },
                simpleStore: getPlugin().$$getSimpleStore("p2p-sync"),
            };
            this._replicatorInstance = new TrysteroReplicator(env);
            // p2p_replicator.set(this.p2pReplicator);
            return this._replicatorInstance;
        } catch (e) {
            this._log(
                e instanceof Error ? e.message : "Something occurred on Initialising P2P Replicator",
                LOG_LEVEL_INFO
            );
            this._log(e, LOG_LEVEL_VERBOSE);
            throw e;
        }
    }
}
