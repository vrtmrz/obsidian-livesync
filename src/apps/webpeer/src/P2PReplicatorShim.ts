import { PouchDB } from "@lib/pouchdb/pouchdb-browser";
import {
    type EntryDoc,
    type ObsidianLiveSyncSettings,
    type P2PSyncSetting,
    LOG_LEVEL_VERBOSE,
    P2P_DEFAULT_SETTINGS,
    REMOTE_P2P,
} from "@lib/common/types";
import { eventHub } from "@lib/hub/hub";

import type { Confirm } from "@lib/interfaces/Confirm";
import { LOG_LEVEL_NOTICE, Logger } from "@lib/common/logger";
import { storeP2PStatusLine } from "./CommandsShim";
import {
    EVENT_P2P_PEER_SHOW_EXTRA_MENU,
    type PeerStatus,
    type PluginShim,
} from "@lib/replication/trystero/P2PReplicatorPaneCommon";
import { P2PLogCollector, type P2PReplicatorBase, useP2PReplicator } from "@lib/replication/trystero/P2PReplicatorCore";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import { EVENT_SETTING_SAVED } from "@lib/events/coreEvents";
import { unique } from "octagonal-wheels/collection";
import { BrowserServiceHub } from "@lib/services/BrowserServices";
import { SETTING_KEY_P2P_DEVICE_NAME } from "@lib/common/types";
import { ServiceContext } from "@lib/services/base/ServiceBase";
import type { InjectableServiceHub } from "@lib/services/InjectableServices";
import { Menu } from "@lib/services/implements/browser/Menu";
import { SimpleStoreIDBv2 } from "octagonal-wheels/databases/SimpleStoreIDBv2";
import type { BrowserAPIService } from "@/lib/src/services/implements/browser/BrowserAPIService";
import type { InjectableSettingService } from "@/lib/src/services/implements/injectable/InjectableSettingService";
import { LiveSyncTrysteroReplicator } from "@lib/replication/trystero/LiveSyncTrysteroReplicator";

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

export class P2PReplicatorShim implements P2PReplicatorBase {
    storeP2PStatusLine = reactiveSource("");
    plugin!: PluginShim;
    confirm!: Confirm;
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

    private _liveSyncReplicator?: LiveSyncTrysteroReplicator;
    p2pLogCollector!: P2PLogCollector;

    private _initP2PReplicator() {
        const {
            replicator,
            p2pLogCollector,
            storeP2PStatusLine: p2pStatusLine,
        } = useP2PReplicator({ services: this.services } as any);
        this._liveSyncReplicator = replicator;
        this.p2pLogCollector = p2pLogCollector;
        p2pLogCollector.p2pReplicationLine.onChanged((line) => {
            storeP2PStatusLine.set(line.value);
        });
    }

    constructor() {
        const browserServiceHub = new BrowserServiceHub<ServiceContext>();
        this.services = browserServiceHub;

        (this.services.API as BrowserAPIService<ServiceContext>).getSystemVaultName.setHandler(
            () => "p2p-livesync-web-peer"
        );
        const repStore = SimpleStoreIDBv2.open<any>("p2p-livesync-web-peer");
        this._simpleStore = repStore;
        let _settings = { ...P2P_DEFAULT_SETTINGS, additionalSuffixOfDatabaseName: "" } as ObsidianLiveSyncSettings;
        this.services.setting.settings = _settings as any;
        (this.services.setting as InjectableSettingService<any>).saveData.setHandler(async (data) => {
            await repStore.set("settings", data);
            eventHub.emitEvent(EVENT_SETTING_SAVED, data);
        });
        (this.services.setting as InjectableSettingService<any>).loadData.setHandler(async () => {
            const settings = { ..._settings, ...((await repStore.get("settings")) as ObsidianLiveSyncSettings) };
            return settings;
        });
    }

    get settings() {
        return this.services.setting.currentSettings() as P2PSyncSetting;
    }

    async init() {
        this.confirm = this.services.UI.confirm;

        if (this.db) {
            try {
                await this.closeDB();
            } catch (ex) {
                Logger("Error closing db", LOG_LEVEL_VERBOSE);
                Logger(ex, LOG_LEVEL_VERBOSE);
            }
        }

        await this.services.setting.loadSettings();
        this.plugin = {
            services: this.services,
            core: {
                services: this.services,
            },
        };
        const database_name = this.settings.P2P_AppID + "-" + this.settings.P2P_roomID + "p2p-livesync-web-peer";
        this.db = new PouchDB<EntryDoc>(database_name);

        this._initP2PReplicator();

        setTimeout(() => {
            if (this.settings.P2P_AutoStart && this.settings.P2P_Enabled) {
                void this.open();
            }
        }, 1000);
        return this;
    }

    _log(msg: any, level?: any): void {
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
    handleReplicatedDocuments(_docs: EntryDoc[]): Promise<boolean> {
        return Promise.resolve(true);
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
    }

    async open() {
        await this._liveSyncReplicator?.open();
    }

    async close() {
        await this._liveSyncReplicator?.close();
    }

    enableBroadcastCastings() {
        return this._liveSyncReplicator?.enableBroadcastChanges();
    }
    disableBroadcastCastings() {
        return this._liveSyncReplicator?.disableBroadcastChanges();
    }

    get replicator() {
        return this._liveSyncReplicator;
    }

    async replicateFrom(peer: PeerStatus) {
        const r = this._liveSyncReplicator;
        if (!r) return;
        await r.replicateFrom(peer.peerId);
    }

    async replicateTo(peer: PeerStatus) {
        await this._liveSyncReplicator?.requestSynchroniseToPeer(peer.peerId);
    }

    async getRemoteConfig(peer: PeerStatus) {
        Logger(
            `Requesting remote config for ${peer.name}. Please input the passphrase on the remote device`,
            LOG_LEVEL_NOTICE
        );
        const remoteConfig = await this._liveSyncReplicator?.getRemoteConfig(peer.peerId);
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
                            { title: "Rebuild from remote device" }
                        );
                        if (yn2 === "yes") {
                            remoteConfig.remoteType = REMOTE_P2P;
                            remoteConfig.P2P_RebuildFrom = peer.name;
                        }
                    }
                }
                await this.services.setting.applyPartial(remoteConfig, true);
                if (yn !== DROP) {
                    await this.plugin.core.services.appLifecycle.scheduleRestart();
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
        const currentSettingAll = this.plugin.core.services.setting.currentSettings();
        const currentSetting = {
            [targetSetting]: currentSettingAll ? currentSettingAll[targetSetting] : "",
        };
        if (peer[prop]) {
            currentSetting[targetSetting] = removeFromList(peer.name, currentSetting[targetSetting]);
        } else {
            currentSetting[targetSetting] = addToList(peer.name, currentSetting[targetSetting]);
        }
        await this.plugin.core.services.setting.applyPartial(currentSetting, true);
    }
}

export const cmdSyncShim = new P2PReplicatorShim();
