import { WorkspaceLeaf } from "obsidian";
import ReplicatorPaneComponent from "./P2PReplicatorPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { mount } from "svelte";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
export const VIEW_TYPE_P2P = "p2p-replicator";

export enum AcceptedStatus {
    UNKNOWN = "Unknown",
    ACCEPTED = "Accepted",
    DENIED = "Denied",
    ACCEPTED_IN_SESSION = "Accepted in session",
    DENIED_IN_SESSION = "Denied in session",
}

export enum ConnectionStatus {
    CONNECTED = "Connected",
    CONNECTED_LIVE = "Connected(live)",
    DISCONNECTED = "Disconnected",
}
export type PeerStatus = {
    name: string;
    peerId: string;
    syncOnConnect: boolean;
    watchOnConnect: boolean;
    syncOnReplicationCommand: boolean;
    accepted: AcceptedStatus;
    status: ConnectionStatus;
    isFetching: boolean;
    isSending: boolean;
    isWatching: boolean;
};

export class P2PReplicatorPaneView extends SvelteItemView {
    plugin: ObsidianLiveSyncPlugin;
    icon = "waypoints";
    title: string = "";
    navigation = false;

    getIcon(): string {
        return "waypoints";
    }

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_P2P;
    }

    getDisplayText() {
        return "Peer-to-Peer Replicator";
    }

    instantiateComponent(target: HTMLElement) {
        return mount(ReplicatorPaneComponent, {
            target: target,
            props: {
                plugin: this.plugin,
            },
        });
    }
}
