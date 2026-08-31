import { App, Modal } from "@/deps.ts";
import P2POpenReplicationPane from "./P2POpenReplicationPane.svelte";
import { mount, unmount } from "svelte";
import type { P2PServiceViews } from "@vrtmrz/livesync-commonlib/p2p";

/**
 * Reports action completion so the pane does not infer success merely from a
 * settled Promise.
 */
export type P2POpenReplicationModalCallback = {
    onSync: (peerId: string) => Promise<boolean>;
    onSyncAndClose: (peerId: string) => Promise<boolean>;
};

export class P2POpenReplicationModal extends Modal {
    p2p: P2PServiceViews;
    callback?: P2POpenReplicationModalCallback;
    component?: ReturnType<typeof mount>;
    showResult: boolean;
    title: string;
    onClosed?: () => void;
    rebuildMode: boolean;

    constructor(
        app: App,
        p2p: P2PServiceViews,
        callback?: P2POpenReplicationModalCallback,
        showResult: boolean = false,
        title: string = "P2P Replication",
        onClosed?: () => void,
        rebuildMode: boolean = false
    ) {
        super(app);
        this.p2p = p2p;
        this.callback = callback;
        this.showResult = showResult;
        this.title = title;
        this.onClosed = onClosed;
        this.rebuildMode = rebuildMode;
    }

    async onSync(peerId: string): Promise<boolean> {
        if (this.callback?.onSync) {
            return await this.callback.onSync(peerId);
        }
        return false;
    }

    async onSyncAndClose(peerId: string): Promise<boolean> {
        let completed = false;
        if (this.callback?.onSyncAndClose) {
            completed = await this.callback.onSyncAndClose(peerId);
        }
        this.close();
        return completed;
    }

    override onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        contentEl.empty();

        if (this.component === undefined) {
            this.component = mount(P2POpenReplicationPane, {
                target: contentEl,
                props: {
                    p2p: this.p2p,
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
