import { WorkspaceLeaf } from "@/deps.ts";
import { mount } from "svelte";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";
import type { P2PServiceViews } from "@vrtmrz/livesync-commonlib/p2p";
import P2PServerStatusPane from "./P2PServerStatusPane.svelte";

export const VIEW_TYPE_P2P_SERVER_STATUS = "p2p-server-status";

export class P2PServerStatusPaneView extends SvelteItemView {
    core: LiveSyncBaseCore;
    private readonly p2p: P2PServiceViews;
    override icon = "waypoints";
    override navigation = false;

    constructor(leaf: WorkspaceLeaf, core: LiveSyncBaseCore, p2p: P2PServiceViews) {
        super(leaf);
        this.core = core;
        this.p2p = p2p;
    }

    override getIcon(): string {
        return "waypoints";
    }

    getViewType() {
        return VIEW_TYPE_P2P_SERVER_STATUS;
    }

    getDisplayText() {
        return "P2P Status";
    }

    instantiateComponent(target: HTMLElement) {
        return mount(P2PServerStatusPane, {
            target,
            props: {
                p2p: this.p2p,
                core: this.core,
            },
        });
    }
}
