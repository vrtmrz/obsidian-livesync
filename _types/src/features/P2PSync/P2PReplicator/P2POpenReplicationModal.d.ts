// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { App, Modal } from "@/deps.ts";
import { mount } from "svelte";
import type { LiveSyncTrysteroReplicator } from "@lib/replication/trystero/LiveSyncTrysteroReplicator";
export type P2POpenReplicationModalCallback = {
    onSync: (peerId: string) => Promise<void>;
    onSyncAndClose: (peerId: string) => Promise<void>;
};
export declare class P2POpenReplicationModal extends Modal {
    liveSyncReplicator: LiveSyncTrysteroReplicator;
    callback?: P2POpenReplicationModalCallback;
    component?: ReturnType<typeof mount>;
    showResult: boolean;
    title: string;
    onClosed?: () => void;
    rebuildMode: boolean;
    constructor(app: App, liveSyncReplicator: LiveSyncTrysteroReplicator, callback?: P2POpenReplicationModalCallback, showResult?: boolean, title?: string, onClosed?: () => void, rebuildMode?: boolean);
    onSync(peerId: string): Promise<void>;
    onSyncAndClose(peerId: string): Promise<void>;
    onOpen(): void;
    onClose(): void;
}
