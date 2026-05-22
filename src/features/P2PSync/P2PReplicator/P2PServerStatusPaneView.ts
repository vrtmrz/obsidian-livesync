import { WorkspaceLeaf } from "@/deps.ts";
import { mount } from "svelte";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";
import type { P2PPaneParams } from "@/lib/src/replication/trystero/UseP2PReplicatorResult";
import P2PServerStatusPane from "./P2PServerStatusPane.svelte";

export const VIEW_TYPE_P2P_SERVER_STATUS = "p2p-server-status";

export class P2PServerStatusPaneView extends SvelteItemView {
    core: LiveSyncBaseCore;
    private _p2pResult: P2PPaneParams;
    override icon = "waypoints";
    override navigation = false;

    constructor(leaf: WorkspaceLeaf, core: LiveSyncBaseCore, p2pResult: P2PPaneParams) {
        super(leaf);
        this.core = core;
        this._p2pResult = p2pResult;
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
                liveSyncReplicator: this._p2pResult.replicator,
                core: this.core,
            },
        });
    }
}
