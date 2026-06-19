// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 6de1db1
import { mount } from "svelte";
import { App, Modal } from "@/deps.ts";
import ObsidianLiveSyncPlugin from "@/main.ts";
export declare class PluginDialogModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    component: ReturnType<typeof mount> | undefined;
    isOpened(): boolean;
    constructor(app: App, plugin: ObsidianLiveSyncPlugin);
    onOpen(): void;
    onClose(): void;
}
