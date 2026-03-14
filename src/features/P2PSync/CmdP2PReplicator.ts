import { P2PReplicatorPaneView, VIEW_TYPE_P2P } from "./P2PReplicator/P2PReplicatorPaneView.ts";
import {
    AutoAccepting,
    LOG_LEVEL_NOTICE,
    REMOTE_P2P,
    type P2PSyncSetting,
    type RemoteDBSettings,
} from "../../lib/src/common/types.ts";
import { LiveSyncCommands } from "../LiveSyncCommands.ts";
import { LiveSyncTrysteroReplicator } from "../../lib/src/replication/trystero/LiveSyncTrysteroReplicator.ts";
import { EVENT_REQUEST_OPEN_P2P, eventHub } from "../../common/events.ts";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator.ts";
import { Logger } from "octagonal-wheels/common/logger";
import {
    P2PLogCollector,
    type P2PReplicatorBase,
    useP2PReplicator,
} from "../../lib/src/replication/trystero/P2PReplicatorCore.ts";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { Confirm } from "../../lib/src/interfaces/Confirm.ts";
import type ObsidianLiveSyncPlugin from "../../main.ts";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { LiveSyncCore } from "../../main.ts";
import type { EntryDoc } from "../../lib/src/common/types.ts";

export class P2PReplicator extends LiveSyncCommands implements P2PReplicatorBase {
    storeP2PStatusLine!: ReactiveSource<string>;
    p2pLogCollector!: P2PLogCollector;

    private _liveSyncReplicator?: LiveSyncTrysteroReplicator;

    get liveSyncReplicator() {
        return this._liveSyncReplicator;
    }

    getSettings(): P2PSyncSetting {
        return this.core.settings;
    }
    getDB() {
        return this.core.localDatabase.localDatabase;
    }
    get confirm(): Confirm {
        return this.core.confirm;
    }
    _simpleStore!: SimpleStore<any>;
    simpleStore(): SimpleStore<any> {
        return this._simpleStore;
    }

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore) {
        super(plugin, core);
        this.afterConstructor();
    }

    async handleReplicatedDocuments(docs: EntryDoc[]): Promise<boolean> {
        return await this.services.replication.parseSynchroniseResult(
            docs as PouchDB.Core.ExistingDocument<EntryDoc>[]
        );
    }

    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(new LiveSyncTrysteroReplicator({ services: this.services }));
        }
        return undefined!;
    }

    afterConstructor() {
        return;
    }

    async open() {
        await this._liveSyncReplicator?.open();
    }

    async close() {
        await this._liveSyncReplicator?.close();
    }

    getConfig(key: string) {
        return this.services.config.getSmallConfig(key);
    }
    setConfig(key: string, value: string) {
        return this.services.config.setSmallConfig(key, value);
    }
    enableBroadcastCastings() {
        return this._liveSyncReplicator?.enableBroadcastChanges();
    }
    disableBroadcastCastings() {
        return this._liveSyncReplicator?.disableBroadcastChanges();
    }

    init() {
        this._simpleStore = this.services.keyValueDB.openSimpleStore("p2p-sync");
        return Promise.resolve(this);
    }

    onunload(): void {
        void this.close();
    }

    onload(): void | Promise<void> {
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P, () => {
            void this.openPane();
        });
    }

    private async _allSuspendExtraSync() {
        this.plugin.core.settings.P2P_Enabled = false;
        this.plugin.core.settings.P2P_AutoAccepting = AutoAccepting.NONE;
        this.plugin.core.settings.P2P_AutoBroadcast = false;
        this.plugin.core.settings.P2P_AutoStart = false;
        this.plugin.core.settings.P2P_AutoSyncPeers = "";
        this.plugin.core.settings.P2P_AutoWatchPeers = "";
        return await Promise.resolve(true);
    }

    async openPane() {
        await this.services.API.showWindow(VIEW_TYPE_P2P);
    }

    async _everyOnloadStart(): Promise<boolean> {
        this.plugin.registerView(
            VIEW_TYPE_P2P,
            (leaf) => new P2PReplicatorPaneView(leaf, this.plugin.core, this.plugin)
        );
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
                    return !(this._liveSyncReplicator?.server?.isServing ?? false);
                }
                void this.open();
            },
        });
        this.plugin.addCommand({
            id: "p2p-close-connection",
            name: "P2P Sync : Disconnect from the Signalling Server",
            checkCallback: (isChecking) => {
                if (isChecking) {
                    return this._liveSyncReplicator?.server?.isServing ?? false;
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
                    if (!this._liveSyncReplicator?.server?.isServing) return false;
                    return true;
                }
                void this._liveSyncReplicator?.replicateFromCommand(false);
            },
        });
        this.plugin
            .addRibbonIcon("waypoints", "P2P Replicator", async () => {
                await this.openPane();
            })
            .addClass("livesync-ribbon-replicate-p2p");

        return await Promise.resolve(true);
    }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        // Initialise useP2PReplicator — wires lifecycle, event handlers, and log collector
        const { replicator, p2pLogCollector, storeP2PStatusLine } = useP2PReplicator({ services } as any);
        this._liveSyncReplicator = replicator;
        this.p2pLogCollector = p2pLogCollector;
        this.storeP2PStatusLine = storeP2PStatusLine;

        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.setting.suspendExtraSync.addHandler(this._allSuspendExtraSync.bind(this));
    }
}
