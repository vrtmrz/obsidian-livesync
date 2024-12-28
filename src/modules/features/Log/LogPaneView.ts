import { ItemView, WorkspaceLeaf } from "obsidian";
import LogPaneComponent from "./LogPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
export const VIEW_TYPE_LOG = "log-log";
//Log view
export class LogPaneView extends ItemView {
    component?: LogPaneComponent;
    plugin: ObsidianLiveSyncPlugin;
    icon = "view-log";
    title: string = "";
    navigation = true;

    getIcon(): string {
        return "view-log";
    }

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_LOG;
    }

    getDisplayText() {
        return "Self-Hosted LiveSync Log";
    }

    async onOpen() {
        this.component = new LogPaneComponent({
            target: this.contentEl,
            props: {},
        });
        await Promise.resolve();
    }

    async onClose() {
        this.component?.$destroy();
        await Promise.resolve();
    }
}
