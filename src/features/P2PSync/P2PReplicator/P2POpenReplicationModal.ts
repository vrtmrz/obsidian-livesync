import { App, Modal } from "@/deps.ts";
import P2POpenReplicationPane from "./P2POpenReplicationPane.svelte";
import { mount, unmount } from "svelte";
import type { LiveSyncTrysteroReplicator } from "@/lib/src/replication/trystero/LiveSyncTrysteroReplicator";

export type P2POpenReplicationModalCallback = {
    onSync: (peerId: string) => Promise<void>;
    onSyncAndClose: (peerId: string) => Promise<void>;
};

export class P2POpenReplicationModal extends Modal {
    liveSyncReplicator: LiveSyncTrysteroReplicator;
    callback?: P2POpenReplicationModalCallback;
    component?: ReturnType<typeof mount>;
    showResult: boolean;
    title: string;
    onClosed?: () => void;
    rebuildMode: boolean;

    constructor(
        app: App,
        liveSyncReplicator: LiveSyncTrysteroReplicator,
        callback?: P2POpenReplicationModalCallback,
        showResult: boolean = false,
        title: string = "P2P Replication",
        onClosed?: () => void,
        rebuildMode: boolean = false
    ) {
        super(app);
        this.liveSyncReplicator = liveSyncReplicator;
        this.callback = callback;
        this.showResult = showResult;
        this.title = title;
        this.onClosed = onClosed;
        this.rebuildMode = rebuildMode;
    }

    async onSync(peerId: string) {
        if (this.callback?.onSync) {
            await this.callback.onSync(peerId);
        }
    }

    async onSyncAndClose(peerId: string) {
        if (this.callback?.onSyncAndClose) {
            await this.callback.onSyncAndClose(peerId);
        }
        this.close();
    }

    override onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        contentEl.empty();

        if (this.component === undefined) {
            this.component = mount(P2POpenReplicationPane, {
                target: contentEl,
                props: {
                    liveSyncReplicator: this.liveSyncReplicator,
                    onSync: (peerId: string) => this.onSync(peerId),
                    onSyncAndClose: (peerId: string) => this.onSyncAndClose(peerId),
                    onClose: () => this.close(),
                    showResult: this.showResult,
                    rebuildMode: this.rebuildMode,
                },
            });
        }
    }

    override onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.component !== undefined) {
            void unmount(this.component);
            this.component = undefined;
        }
        this.onClosed?.();
    }
}
