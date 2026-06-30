// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { WorkspaceLeaf } from "@/deps.ts";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";
import type { P2PPaneParams } from "@lib/replication/trystero/UseP2PReplicatorResult";
export declare const VIEW_TYPE_P2P_SERVER_STATUS = "p2p-server-status";
export declare class P2PServerStatusPaneView extends SvelteItemView {
    core: LiveSyncBaseCore;
    private _p2pResult;
    icon: string;
    navigation: boolean;
    constructor(leaf: WorkspaceLeaf, core: LiveSyncBaseCore, p2pResult: P2PPaneParams);
    getIcon(): string;
    getViewType(): string;
    getDisplayText(): string;
    instantiateComponent(target: HTMLElement): {
        $on?(type: string, callback: (e: any) => void): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
        $set?(props: Partial<Record<string, any>>): void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
}
