// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { Menu, WorkspaceLeaf } from "@/deps.ts";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
import { type PeerStatus } from "@lib/replication/trystero/P2PReplicatorPaneCommon.ts";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";
import type { P2PPaneParams } from "@lib/replication/trystero/UseP2PReplicatorResult";
export declare const VIEW_TYPE_P2P = "p2p-replicator";
export declare class P2PReplicatorPaneView extends SvelteItemView {
    core: LiveSyncBaseCore;
    private _p2pResult;
    icon: string;
    title: string;
    navigation: boolean;
    getIcon(): string;
    get replicator(): import("../../../lib/src/replication/trystero/LiveSyncTrysteroReplicator").LiveSyncTrysteroReplicator;
    replicateFrom(peer: PeerStatus): Promise<void>;
    replicateTo(peer: PeerStatus): Promise<void>;
    getRemoteConfig(peer: PeerStatus): Promise<void>;
    toggleProp(peer: PeerStatus, prop: "syncOnConnect" | "watchOnConnect" | "syncOnReplicationCommand"): Promise<void>;
    m?: Menu;
    constructor(leaf: WorkspaceLeaf, core: LiveSyncBaseCore, p2pResult: P2PPaneParams);
    getViewType(): string;
    getDisplayText(): string;
    onClose(): Promise<void>;
    instantiateComponent(target: HTMLElement): {
        $on?(type: string, callback: (e: any) => void): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
        $set?(props: Partial<Record<string, any>>): void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
}
