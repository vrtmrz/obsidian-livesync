import type { IObsidianModule } from "../../modules/AbstractObsidianModule";
import { P2PReplicatorPaneView, VIEW_TYPE_P2P } from "./P2PReplicator/P2PReplicatorPaneView.ts";
import {
    AutoAccepting,
    LOG_LEVEL_NOTICE,
    REMOTE_P2P,
    type EntryDoc,
    type P2PSyncSetting,
    type RemoteDBSettings,
} from "../../lib/src/common/types.ts";
import { LiveSyncCommands } from "../LiveSyncCommands.ts";
import { LiveSyncTrysteroReplicator } from "../../lib/src/replication/trystero/LiveSyncTrysteroReplicator.ts";
import { EVENT_REQUEST_OPEN_P2P, eventHub } from "../../common/events.ts";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator.ts";
import { Logger } from "octagonal-wheels/common/logger";
import type { CommandShim } from "../../lib/src/replication/trystero/P2PReplicatorPaneCommon.ts";
import {
    P2PReplicatorMixIn,
    removeP2PReplicatorInstance,
    type P2PReplicatorBase,
} from "../../lib/src/replication/trystero/P2PReplicatorCore.ts";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { Confirm } from "../../lib/src/interfaces/Confirm.ts";
import type ObsidianLiveSyncPlugin from "../../main.ts";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { getPlatformName } from "../../lib/src/PlatformAPIs/obsidian/Environment.ts";

class P2PReplicatorCommandBase extends LiveSyncCommands implements P2PReplicatorBase {
    storeP2PStatusLine = reactiveSource("");

    getSettings(): P2PSyncSetting {
        return this.plugin.settings;
    }
    get settings() {
        return this.plugin.settings;
    }
    getDB() {
        return this.plugin.localDatabase.localDatabase;
    }

    get confirm(): Confirm {
        return this.plugin.confirm;
    }
    _simpleStore!: SimpleStore<any>;

    simpleStore(): SimpleStore<any> {
        return this._simpleStore;
    }

    constructor(plugin: ObsidianLiveSyncPlugin) {
        super(plugin);
    }

    async handleReplicatedDocuments(docs: EntryDoc[]): Promise<void> {
        // console.log("Processing Replicated Docs", docs);
        return await this.plugin.$$parseReplicationResult(docs as PouchDB.Core.ExistingDocument<EntryDoc>[]);
    }
    onunload(): void {
        throw new Error("Method not implemented.");
    }
    onload(): void | Promise<void> {
        throw new Error("Method not implemented.");
    }

    init() {
        this._simpleStore = this.plugin.$$getSimpleStore("p2p-sync");
        return Promise.resolve(this);
    }
}

export class P2PReplicator
    extends P2PReplicatorMixIn(P2PReplicatorCommandBase)
    implements IObsidianModule, CommandShim
{
    storeP2PStatusLine = reactiveSource("");
    $anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(new LiveSyncTrysteroReplicator(this.plugin));
        }
        return undefined!;
    }
    override getPlatform(): string {
        return getPlatformName();
    }

    override onunload(): void {
        removeP2PReplicatorInstance();
        void this.close();
    }

    override onload(): void | Promise<void> {
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P, () => {
            void this.openPane();
        });
        this.p2pLogCollector.p2pReplicationLine.onChanged((line) => {
            this.storeP2PStatusLine.value = line.value;
        });
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
        const rep = this._replicatorInstance;
        rep?.allowReconnection();
        return Promise.resolve(true);
    }
    $everyBeforeSuspendProcess(): Promise<boolean> {
        const rep = this._replicatorInstance;
        rep?.disconnectFromServer();
        return Promise.resolve(true);
    }
}
