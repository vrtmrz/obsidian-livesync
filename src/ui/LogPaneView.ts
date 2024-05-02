import {
    ItemView,
    WorkspaceLeaf
} from "obsidian";
import LogPaneComponent from "./LogPane.svelte";
import type ObsidianLiveSyncPlugin from "../main.ts";
export const VIEW_TYPE_LOG = "log-log";
//Log view
export class LogPaneView extends ItemView {

    component: LogPaneComponent;
    plugin: ObsidianLiveSyncPlugin;
    icon: "view-log";
    title: string;
    navigation: true;

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
        return "Self-hosted LiveSync Log";
    }

    // eslint-disable-next-line require-await
    async onOpen() {
        this.component = new LogPaneComponent({
            target: this.contentEl,
            props: {
            },
        });
    }

    // eslint-disable-next-line require-await
    async onClose() {
        this.component.$destroy();
    }
}
