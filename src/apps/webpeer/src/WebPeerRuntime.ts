import { type P2PSyncSetting, SETTING_KEY_P2P_DEVICE_NAME } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { EVENT_LAYOUT_READY } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import type { PeerStatus } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PReplicatorPaneCommon";
import { P2PLogCollector } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PLogCollector";
import type { LiveSyncTrysteroReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/LiveSyncTrysteroReplicator";
import type { UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult";
import { useP2PReplicatorFeature } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/useP2PReplicatorFeature";
import { ServiceContext, type LiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { unique } from "octagonal-wheels/collection";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";

import {
    createLiveSyncBrowserServiceHub,
    type LiveSyncBrowserServiceHub,
} from "@/apps/browser/createLiveSyncBrowserServiceHub";
import { Menu } from "@/apps/browser/BrowserMenu";
import type { P2PReplicatorPaneHost } from "@/features/P2PSync/P2PReplicator/P2PReplicatorPaneHost";
import { translateLiveSyncMessage } from "@/common/translation";
import { WEBPEER_STORE_NAME, createWebPeerPersistence } from "./WebPeerPersistence";

export interface WebPeerRuntimeOptions {
    context?: ServiceContext;
    store?: SimpleStore<unknown>;
    deviceName?: string;
    systemVaultName?: string;
}

function addToList(item: string, list: string): string {
    return unique(
        list
            .split(",")
            .map((entry) => entry.trim())
            .concat(item)
            .filter(Boolean)
    ).join(",");
}

function removeFromList(item: string, list: string): string {
    return list
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== item)
        .filter(Boolean)
        .join(",");
}

export class WebPeerRuntime {
    readonly context: ServiceContext;
    readonly services: LiveSyncBrowserServiceHub<ServiceContext>;
    readonly p2p: UseP2PReplicatorResult;
    readonly p2pLogCollector: P2PLogCollector;
    readonly paneHost: P2PReplicatorPaneHost;

    private menu?: Menu;
    private restartScheduled = false;
    private startPromise?: Promise<this>;
    private shutdownPromise?: Promise<void>;

    constructor(private readonly options: WebPeerRuntimeOptions = {}) {
        const persistence = createWebPeerPersistence(options.store);
        this.context = options.context ?? new ServiceContext({ translate: translateLiveSyncMessage });
        this.services = createLiveSyncBrowserServiceHub<ServiceContext>({
            context: this.context,
            getSystemVaultName: () => options.systemVaultName ?? WEBPEER_STORE_NAME,
            settings: persistence.settings,
            restart: {
                schedule: () => this.scheduleRestart(),
                perform: () => this.scheduleRestart(),
                ask: () => this.scheduleRestart(),
                isScheduled: () => this.restartScheduled,
            },
        });
        this.p2p = useP2PReplicatorFeature({
            services: this.services,
            serviceModules: {},
        });
        this.p2pLogCollector = new P2PLogCollector(this.events);
        this.paneHost = {
            services: this.services,
            p2p: this.p2p,
            showPeerMenu: (peer, event) => this.showPeerMenu(peer, event),
        };
    }

    get events(): LiveSyncEventHub {
        return this.context.events;
    }

    get currentReplicator(): LiveSyncTrysteroReplicator {
        return this.p2p.replicator;
    }

    get settings(): P2PSyncSetting {
        return this.services.setting.currentSettings();
    }

    get statusLine() {
        return this.p2pLogCollector.p2pReplicationLine;
    }

    start(): Promise<this> {
        this.startPromise ??= this.startRuntime();
        return this.startPromise;
    }

    private async startRuntime(): Promise<this> {
        await this.services.setting.loadSettings();
        const deviceName = this.options.deviceName?.trim();
        if (deviceName) {
            this.services.config.setSmallConfig(SETTING_KEY_P2P_DEVICE_NAME, deviceName);
        }
        const opened = await this.services.database.openDatabase({
            replicator: this.services.replicator,
            databaseEvents: this.services.databaseEvents,
        });
        if (!opened) {
            throw new Error("WebPeer local database could not be opened");
        }
        this.services.appLifecycle.markIsReady();
        this.events.emitEvent(EVENT_LAYOUT_READY);
        if (this.settings.P2P_AutoStart && this.settings.P2P_Enabled) {
            compatGlobal.setTimeout(() => void this.currentReplicator.open(), 100);
        }
        return this;
    }

    shutdown(): Promise<void> {
        this.shutdownPromise ??= this.shutdownRuntime();
        return this.shutdownPromise;
    }

    private async shutdownRuntime(): Promise<void> {
        this.menu?.hide();
        this.menu = undefined;
        if (!this.services.control.hasUnloaded()) {
            await this.services.control.onUnload();
        }
    }

    private scheduleRestart(): void {
        if (this.restartScheduled) {
            return;
        }
        this.restartScheduled = true;
        compatGlobal.setTimeout(() => compatGlobal.location.reload(), 0);
    }

    private showPeerMenu(peer: PeerStatus, event: MouseEvent): void {
        this.menu?.hide();
        this.menu = new Menu()
            .addItem((item) =>
                item.setTitle("📥 Only fetch").onClick(async () => {
                    await this.currentReplicator.replicateFrom(peer.peerId);
                })
            )
            .addItem((item) =>
                item.setTitle("📤 Only send").onClick(async () => {
                    await this.currentReplicator.requestSynchroniseToPeer(peer.peerId);
                })
            )
            .addSeparator()
            .addItem((item) => {
                item.setTitle("Toggle sync on connect")
                    .onClick(() => this.togglePeerSetting(peer, "syncOnConnect"))
                    .setIcon(peer.syncOnConnect ? "checkmark" : null);
            })
            .addItem((item) => {
                item.setTitle("Toggle watch on connect")
                    .onClick(() => this.togglePeerSetting(peer, "watchOnConnect"))
                    .setIcon(peer.watchOnConnect ? "checkmark" : null);
            })
            .addItem((item) => {
                item.setTitle("Toggle sync on `Replicate now` command")
                    .onClick(() => this.togglePeerSetting(peer, "syncOnReplicationCommand"))
                    .setIcon(peer.syncOnReplicationCommand ? "checkmark" : null);
            });
        void this.menu.showAtPosition({ x: event.x, y: event.y });
    }

    private async togglePeerSetting(
        peer: PeerStatus,
        property: "syncOnConnect" | "watchOnConnect" | "syncOnReplicationCommand"
    ): Promise<void> {
        const settingMap = {
            syncOnConnect: "P2P_AutoSyncPeers",
            watchOnConnect: "P2P_AutoWatchPeers",
            syncOnReplicationCommand: "P2P_SyncOnReplication",
        } as const;
        const settingKey = settingMap[property];
        const currentValue = this.services.setting.currentSettings()[settingKey] ?? "";
        await this.services.setting.applyPartial(
            {
                [settingKey]: peer[property]
                    ? removeFromList(peer.name, currentValue)
                    : addToList(peer.name, currentValue),
            },
            true
        );
    }

    getDeviceName(): string {
        return this.services.config.getSmallConfig(SETTING_KEY_P2P_DEVICE_NAME) || this.services.vault.getVaultName();
    }
}
