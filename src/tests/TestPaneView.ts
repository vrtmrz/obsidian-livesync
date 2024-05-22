import {
    ItemView,
    WorkspaceLeaf
} from "obsidian";
import TestPaneComponent from "./TestPane.svelte"
import type ObsidianLiveSyncPlugin from "../main"
export const VIEW_TYPE_TEST = "ols-pane-test";
//Log view
export class TestPaneView extends ItemView {

    component?: TestPaneComponent;
    plugin: ObsidianLiveSyncPlugin;
    icon = "view-log";
    title: string = "Self-hosted LiveSync Test and Results"
    navigation = true;

    getIcon(): string {
        return "view-log";
    }

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }


    getViewType() {
        return VIEW_TYPE_TEST;
    }

    getDisplayText() {
        return "Self-hosted LiveSync Test and Results";
    }

    // eslint-disable-next-line require-await
    async onOpen() {
        this.component = new TestPaneComponent({
            target: this.contentEl,
            props: {
                plugin: this.plugin
            },
        });
    }

    // eslint-disable-next-line require-await
    async onClose() {
        this.component?.$destroy();
    }
}
