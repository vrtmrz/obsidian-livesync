import { PouchDB } from "@lib/pouchdb/pouchdb-browser";
import {
    type EntryDoc,
    type LOG_LEVEL,
    type P2PSyncSetting,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    P2P_DEFAULT_SETTINGS,
    REMOTE_P2P,
} from "@lib/common/types";
import { eventHub } from "@lib/hub/hub";

import type { Confirm } from "@lib/interfaces/Confirm";
import { LOG_LEVEL_INFO, Logger } from "@lib/common/logger";
import { storeP2PStatusLine } from "./CommandsShim";
import {
    EVENT_P2P_PEER_SHOW_EXTRA_MENU,
    type CommandShim,
    type PeerStatus,
    type PluginShim,
} from "@lib/replication/trystero/P2PReplicatorPaneCommon";
import {
    closeP2PReplicator,
    openP2PReplicator,
    P2PLogCollector,
    type P2PReplicatorBase,
} from "@lib/replication/trystero/P2PReplicatorCore";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import { EVENT_SETTING_SAVED } from "@lib/events/coreEvents";
import { unique } from "octagonal-wheels/collection";
import { BrowserServiceHub } from "@lib/services/BrowserServices";
import { TrysteroReplicator } from "@lib/replication/trystero/TrysteroReplicator";
import { SETTING_KEY_P2P_DEVICE_NAME } from "@lib/common/types";
import { ServiceContext } from "@lib/services/base/ServiceBase";
import type { InjectableServiceHub } from "@lib/services/InjectableServices";
import { Menu } from "@/lib/src/services/implements/browser/Menu";

function addToList(item: string, list: string) {
    return unique(
        list
            .split(",")
            .map((e) => e.trim())
            .concat(item)
            .filter((p) => p)
    ).join(",");
}
function removeFromList(item: string, list: string) {
    return list
        .split(",")
        .map((e) => e.trim())
        .filter((p) => p !== item)
        .filter((p) => p)
        .join(",");
}

export class P2PReplicatorShim implements P2PReplicatorBase, CommandShim {
    storeP2PStatusLine = reactiveSource("");
    plugin!: PluginShim;
    // environment!: IEnvironment;
    confirm!: Confirm;
    // simpleStoreAPI!: ISimpleStoreAPI;
    db?: PouchDB.Database<EntryDoc>;
    services: InjectableServiceHub<ServiceContext>;

    getDB() {
        if (!this.db) {
            throw new Error("DB not initialized");
        }
        return this.db;
    }
    _simpleStore!: SimpleStore<any>;
    async closeDB() {
        if (this.db) {
            await this.db.close();
            this.db = undefined;
        }
    }
    constructor() {
        const browserServiceHub = new BrowserServiceHub<ServiceContext>();
        this.services = browserServiceHub;
        this.services.vault.getVaultName.setHandler(() => "p2p-livesync-web-peer");
    }
    async init() {
        // const { simpleStoreAPI } = await getWrappedSynchromesh();
        // this.confirm = confirm;
        this.confirm = this.services.UI.confirm;
        // this.environment = environment;

        if (this.db) {
            try {
                await this.closeDB();
            } catch (ex) {
                Logger("Error closing db", LOG_LEVEL_VERBOSE);
                Logger(ex, LOG_LEVEL_VERBOSE);
            }
        }

        const repStore = this.services.database.openSimpleStore<any>("p2p-livesync-web-peer");
        this._simpleStore = repStore;
        let _settings = (await repStore.get("settings")) || ({ ...P2P_DEFAULT_SETTINGS } as P2PSyncSetting);

        this.plugin = {
            saveSettings: async () => {
                await repStore.set("settings", _settings);
                eventHub.emitEvent(EVENT_SETTING_SAVED, _settings);
            },
            get settings() {
                return _settings;
            },
            set settings(newSettings: P2PSyncSetting) {
                _settings = { ..._settings, ...newSettings };
            },
            rebuilder: null,
            services: this.services,
            // $$scheduleAppReload: () => {},
            // $$getVaultName: () => "p2p-livesync-web-peer",
        };
        // const deviceName = this.getDeviceName();
        const database_name = this.settings.P2P_AppID + "-" + this.settings.P2P_roomID + "p2p-livesync-web-peer";
        this.db = new PouchDB<EntryDoc>(database_name);
        setTimeout(() => {
            if (this.settings.P2P_AutoStart && this.settings.P2P_Enabled) {
                void this.open();
            }
        }, 1000);
        return this;
    }
    get settings() {
        return this.plugin.settings;
    }
    _log(msg: any, level?: LOG_LEVEL): void {
        Logger(msg, level);
    }
    _notice(msg: string, key?: string): void {
        Logger(msg, LOG_LEVEL_NOTICE, key);
    }
    getSettings(): P2PSyncSetting {
        return this.settings;
    }
    simpleStore(): SimpleStore<any> {
        return this._simpleStore;
    }
    handleReplicatedDocuments(docs: EntryDoc[]): Promise<void> {
        // No op. This is a client and does not need to process the docs
        return Promise.resolve();
    }

    getPluginShim() {
        return {};
    }
    getConfig(key: string) {
        const vaultName = this.services.vault.getVaultName();
        const dbKey = `${vaultName}-${key}`;
        return localStorage.getItem(dbKey);
    }
    setConfig(key: string, value: string) {
        const vaultName = this.services.vault.getVaultName();
        const dbKey = `${vaultName}-${key}`;
        localStorage.setItem(dbKey, value);
    }

    getDeviceName(): string {
        return this.getConfig(SETTING_KEY_P2P_DEVICE_NAME) ?? this.plugin.services.vault.getVaultName();
    }
    getPlatform(): string {
        return "pseudo-replicator";
    }
    m?: Menu;
    afterConstructor(): void {
        eventHub.onEvent(EVENT_P2P_PEER_SHOW_EXTRA_MENU, ({ peer, event }) => {
            if (this.m) {
                this.m.hide();
            }
            this.m = new Menu()
                .addItem((item) => item.setTitle("📥 Only Fetch").onClick(() => this.replicateFrom(peer)))
                .addItem((item) => item.setTitle("📤 Only Send").onClick(() => this.replicateTo(peer)))
                .addSeparator()
                // .addItem((item) => {
                //     item.setTitle("🔧 Get Configuration").onClick(async () => {
                //         await this.getRemoteConfig(peer);
                //     });
                // })
                // .addSeparator()
                .addItem((item) => {
                    const mark = peer.syncOnConnect ? "checkmark" : null;
                    item.setTitle("Toggle Sync on connect")
                        .onClick(async () => {
                            await this.toggleProp(peer, "syncOnConnect");
                        })
                        .setIcon(mark);
                })
                .addItem((item) => {
                    const mark = peer.watchOnConnect ? "checkmark" : null;
                    item.setTitle("Toggle Watch on connect")
                        .onClick(async () => {
                            await this.toggleProp(peer, "watchOnConnect");
                        })
                        .setIcon(mark);
                })
                .addItem((item) => {
                    const mark = peer.syncOnReplicationCommand ? "checkmark" : null;
                    item.setTitle("Toggle Sync on `Replicate now` command")
                        .onClick(async () => {
                            await this.toggleProp(peer, "syncOnReplicationCommand");
                        })
                        .setIcon(mark);
                });
            void this.m.showAtPosition({ x: event.x, y: event.y });
        });
        this.p2pLogCollector.p2pReplicationLine.onChanged((line) => {
            storeP2PStatusLine.set(line.value);
        });
    }

    _replicatorInstance?: TrysteroReplicator;
    p2pLogCollector = new P2PLogCollector();
    async open() {
        await openP2PReplicator(this);
    }
    async close() {
        await closeP2PReplicator(this);
    }
    enableBroadcastCastings() {
        return this?._replicatorInstance?.enableBroadcastChanges();
    }
    disableBroadcastCastings() {
        return this?._replicatorInstance?.disableBroadcastChanges();
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
            const getPlatform = () => this.getPlatform();
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

    get replicator() {
        return this._replicatorInstance!;
    }
    async replicateFrom(peer: PeerStatus) {
        await this.replicator.replicateFrom(peer.peerId);
    }
    async replicateTo(peer: PeerStatus) {
        await this.replicator.requestSynchroniseToPeer(peer.peerId);
    }
    async getRemoteConfig(peer: PeerStatus) {
        Logger(
            `Requesting remote config for ${peer.name}. Please input the passphrase on the remote device`,
            LOG_LEVEL_NOTICE
        );
        const remoteConfig = await this.replicator.getRemoteConfig(peer.peerId);
        if (remoteConfig) {
            Logger(`Remote config for ${peer.name} is retrieved successfully`);
            const DROP = "Yes, and drop local database";
            const KEEP = "Yes, but keep local database";
            const CANCEL = "No, cancel";
            const yn = await this.confirm.askSelectStringDialogue(
                `Do you really want to apply the remote config? This will overwrite your current config immediately and restart.
    And you can also drop the local database to rebuild from the remote device.`,
                [DROP, KEEP, CANCEL] as const,
                {
                    defaultAction: CANCEL,
                    title: "Apply Remote Config ",
                }
            );
            if (yn === DROP || yn === KEEP) {
                if (yn === DROP) {
                    if (remoteConfig.remoteType !== REMOTE_P2P) {
                        const yn2 = await this.confirm.askYesNoDialog(
                            `Do you want to set the remote type to "P2P Sync" to rebuild by "P2P replication"?`,
                            {
                                title: "Rebuild from remote device",
                            }
                        );
                        if (yn2 === "yes") {
                            remoteConfig.remoteType = REMOTE_P2P;
                            remoteConfig.P2P_RebuildFrom = peer.name;
                        }
                    }
                }
                this.plugin.settings = remoteConfig;
                await this.plugin.saveSettings();
                if (yn === DROP) {
                    await this.plugin.rebuilder.scheduleFetch();
                } else {
                    await this.plugin.services.appLifecycle.scheduleRestart();
                }
            } else {
                Logger(`Cancelled\nRemote config for ${peer.name} is not applied`, LOG_LEVEL_NOTICE);
            }
        } else {
            Logger(`Cannot retrieve remote config for ${peer.peerId}`);
        }
    }

    async toggleProp(peer: PeerStatus, prop: "syncOnConnect" | "watchOnConnect" | "syncOnReplicationCommand") {
        const settingMap = {
            syncOnConnect: "P2P_AutoSyncPeers",
            watchOnConnect: "P2P_AutoWatchPeers",
            syncOnReplicationCommand: "P2P_SyncOnReplication",
        } as const;

        const targetSetting = settingMap[prop];
        if (peer[prop]) {
            this.plugin.settings[targetSetting] = removeFromList(peer.name, this.plugin.settings[targetSetting]);
            await this.plugin.saveSettings();
        } else {
            this.plugin.settings[targetSetting] = addToList(peer.name, this.plugin.settings[targetSetting]);
            await this.plugin.saveSettings();
        }
    }
}

export const cmdSyncShim = new P2PReplicatorShim();
