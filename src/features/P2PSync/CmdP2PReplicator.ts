import { P2PReplicatorPaneView, VIEW_TYPE_P2P } from "./P2PReplicator/P2PReplicatorPaneView.ts";
import {
    AutoAccepting,
    LOG_LEVEL_NOTICE,
    P2P_DEFAULT_SETTINGS,
    REMOTE_P2P,
    type EntryDoc,
    type P2PSyncSetting,
    type RemoteDBSettings,
} from "../../lib/src/common/types.ts";
import { LiveSyncCommands } from "../LiveSyncCommands.ts";
import {
    LiveSyncTrysteroReplicator,
    setReplicatorFunc,
} from "../../lib/src/replication/trystero/LiveSyncTrysteroReplicator.ts";
import { EVENT_REQUEST_OPEN_P2P, eventHub } from "../../common/events.ts";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator.ts";
import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import type { CommandShim } from "../../lib/src/replication/trystero/P2PReplicatorPaneCommon.ts";
import {
    addP2PEventHandlers,
    closeP2PReplicator,
    openP2PReplicator,
    P2PLogCollector,
    removeP2PReplicatorInstance,
    type P2PReplicatorBase,
} from "../../lib/src/replication/trystero/P2PReplicatorCore.ts";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { Confirm } from "../../lib/src/interfaces/Confirm.ts";
import type ObsidianLiveSyncPlugin from "../../main.ts";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
// import { getPlatformName } from "../../lib/src/PlatformAPIs/obsidian/Environment.ts";
import type { LiveSyncCore } from "../../main.ts";
import { TrysteroReplicator } from "../../lib/src/replication/trystero/TrysteroReplicator.ts";
import { SETTING_KEY_P2P_DEVICE_NAME } from "../../lib/src/common/types.ts";

export class P2PReplicator extends LiveSyncCommands implements P2PReplicatorBase, CommandShim {
    storeP2PStatusLine = reactiveSource("");

    getSettings(): P2PSyncSetting {
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
        setReplicatorFunc(() => this._replicatorInstance);
        addP2PEventHandlers(this);
        this.afterConstructor();
        // onBindFunction is called in super class
        // this.onBindFunction(plugin, plugin.services);
    }

    async handleReplicatedDocuments(docs: EntryDoc[]): Promise<boolean> {
        // console.log("Processing Replicated Docs", docs);
        return await this.services.replication.parseSynchroniseResult(
            docs as PouchDB.Core.ExistingDocument<EntryDoc>[]
        );
    }

    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(new LiveSyncTrysteroReplicator(this.plugin));
        }
        return undefined!;
    }
    _replicatorInstance?: TrysteroReplicator;
    p2pLogCollector = new P2PLogCollector();

    afterConstructor() {
        return;
    }

    async open() {
        await openP2PReplicator(this);
    }
    async close() {
        await closeP2PReplicator(this);
    }

    getConfig(key: string) {
        return this.services.config.getSmallConfig(key);
    }
    setConfig(key: string, value: string) {
        return this.services.config.setSmallConfig(key, value);
    }
    enableBroadcastCastings() {
        return this?._replicatorInstance?.enableBroadcastChanges();
    }
    disableBroadcastCastings() {
        return this?._replicatorInstance?.disableBroadcastChanges();
    }

    init() {
        this._simpleStore = this.services.keyValueDB.openSimpleStore("p2p-sync");
        return Promise.resolve(this);
    }

    async initialiseP2PReplicator(): Promise<TrysteroReplicator> {
        await this.init();
        try {
            if (this._replicatorInstance) {
                await this._replicatorInstance.close();
                this._replicatorInstance = undefined;
            }

            if (!this.settings.P2P_AppID) {
                this.settings.P2P_AppID = P2P_DEFAULT_SETTINGS.P2P_AppID;
            }
            const getInitialDeviceName = () =>
                this.getConfig(SETTING_KEY_P2P_DEVICE_NAME) || this.services.vault.getVaultName();

            const getSettings = () => this.settings;
            const store = () => this.simpleStore();
            const getDB = () => this.getDB();

            const getConfirm = () => this.confirm;
            const getPlatform = () => this.services.API.getPlatform();
            const env = {
                get db() {
                    return getDB();
                },
                get confirm() {
                    return getConfirm();
                },
                get deviceName() {
                    return getInitialDeviceName();
                },
                get platform() {
                    return getPlatform();
                },
                get settings() {
                    return getSettings();
                },
                processReplicatedDocs: async (docs: EntryDoc[]): Promise<void> => {
                    await this.handleReplicatedDocuments(docs);
                    // No op. This is a client and does not need to process the docs
                },
                get simpleStore() {
                    return store();
                },
            };
            this._replicatorInstance = new TrysteroReplicator(env);
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

    onunload(): void {
        removeP2PReplicatorInstance();
        void this.close();
    }

    onload(): void | Promise<void> {
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P, () => {
            void this.openPane();
        });
        this.p2pLogCollector.p2pReplicationLine.onChanged((line) => {
            this.storeP2PStatusLine.value = line.value;
        });
    }
    async _everyOnInitializeDatabase(): Promise<boolean> {
        await this.initialiseP2PReplicator();
        return Promise.resolve(true);
    }

    private async _allSuspendExtraSync() {
        this.plugin.settings.P2P_Enabled = false;
        this.plugin.settings.P2P_AutoAccepting = AutoAccepting.NONE;
        this.plugin.settings.P2P_AutoBroadcast = false;
        this.plugin.settings.P2P_AutoStart = false;
        this.plugin.settings.P2P_AutoSyncPeers = "";
        this.plugin.settings.P2P_AutoWatchPeers = "";
        return await Promise.resolve(true);
    }

    // async $everyOnLoadStart() {
    //     return await Promise.resolve();
    // }

    async openPane() {
        await this.services.API.showWindow(VIEW_TYPE_P2P);
    }

    async _everyOnloadStart(): Promise<boolean> {
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
    _everyAfterResumeProcess(): Promise<boolean> {
        if (this.settings.P2P_Enabled && this.settings.P2P_AutoStart) {
            setTimeout(() => void this.open(), 100);
        }
        const rep = this._replicatorInstance;
        rep?.allowReconnection();
        return Promise.resolve(true);
    }
    _everyBeforeSuspendProcess(): Promise<boolean> {
        const rep = this._replicatorInstance;
        rep?.disconnectFromServer();
        return Promise.resolve(true);
    }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
        services.databaseEvents.onDatabaseInitialisation.addHandler(this._everyOnInitializeDatabase.bind(this));
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.appLifecycle.onSuspending.addHandler(this._everyBeforeSuspendProcess.bind(this));
        services.appLifecycle.onResumed.addHandler(this._everyAfterResumeProcess.bind(this));
        services.setting.suspendExtraSync.addHandler(this._allSuspendExtraSync.bind(this));
    }
}
