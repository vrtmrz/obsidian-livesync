import { Menu, WorkspaceLeaf } from "@/deps.ts";
import ReplicatorPaneComponent from "./P2PReplicatorPane.svelte";
import { mount } from "svelte";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
import { eventHub } from "@/common/events.ts";

import { unique } from "octagonal-wheels/collection";
import { LOG_LEVEL_NOTICE, REMOTE_P2P } from "@lib/common/types.ts";
import { Logger } from "@lib/common/logger.ts";
import { EVENT_P2P_PEER_SHOW_EXTRA_MENU, type PeerStatus } from "@lib/replication/trystero/P2PReplicatorPaneCommon.ts";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";
import type { P2PPaneParams } from "@/lib/src/replication/trystero/UseP2PReplicatorResult";
export const VIEW_TYPE_P2P = "p2p-replicator";

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

export class P2PReplicatorPaneView extends SvelteItemView {
    core: LiveSyncBaseCore;
    private _p2pResult: P2PPaneParams;
    override icon = "waypoints";
    title: string = "";
    override navigation = false;

    override getIcon(): string {
        return "waypoints";
    }
    get replicator() {
        return this._p2pResult.replicator;
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
            const yn = await this.core.confirm.askSelectStringDialogue(
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
                        const yn2 = await this.core.confirm.askYesNoDialog(
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

                // this.plugin.settings = remoteConfig;
                // await this.plugin.saveSettings();
                await this.core.services.setting.applyPartial(remoteConfig);
                if (yn === DROP) {
                    await this.core.rebuilder.scheduleFetch();
                } else {
                    this.core.services.appLifecycle.scheduleRestart();
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
        const currentSettingAll = this.core.services.setting.currentSettings();
        const currentSetting = {
            [targetSetting]: currentSettingAll ? currentSettingAll[targetSetting] : "",
        };
        if (peer[prop]) {
            // this.plugin.settings[targetSetting] = removeFromList(peer.name, this.plugin.settings[targetSetting]);
            // await this.plugin.saveSettings();
            currentSetting[targetSetting] = removeFromList(peer.name, currentSetting[targetSetting]);
        } else {
            currentSetting[targetSetting] = addToList(peer.name, currentSetting[targetSetting]);
        }
        await this.core.services.setting.applyPartial(currentSetting, true);
    }
    m?: Menu;
    constructor(leaf: WorkspaceLeaf, core: LiveSyncBaseCore, p2pResult: P2PPaneParams) {
        super(leaf);
        this.core = core;
        this._p2pResult = p2pResult;
        eventHub.onEvent(EVENT_P2P_PEER_SHOW_EXTRA_MENU, ({ peer, event }) => {
            if (this.m) {
                this.m.hide();
            }
            this.m = new Menu()
                .addItem((item) => item.setTitle("📥 Only Fetch").onClick(() => this.replicateFrom(peer)))
                .addItem((item) => item.setTitle("📤 Only Send").onClick(() => this.replicateTo(peer)))
                .addSeparator()
                .addItem((item) => {
                    item.setTitle("🔧 Get Configuration").onClick(async () => {
                        await this.getRemoteConfig(peer);
                    });
                })
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
            this.m.showAtPosition({ x: event.x, y: event.y });
        });
    }

    getViewType() {
        return VIEW_TYPE_P2P;
    }

    getDisplayText() {
        return "Peer-to-Peer Replicator";
    }

    override async onClose(): Promise<void> {
        await super.onClose();
        if (this.m) {
            this.m.hide();
        }
    }
    instantiateComponent(target: HTMLElement) {
        return mount(ReplicatorPaneComponent, {
            target: target,
            props: {
                cmdSync: this._p2pResult.replicator,
                core: this.core,
            },
        });
    }
}
