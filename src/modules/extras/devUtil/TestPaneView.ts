import { ItemView, WorkspaceLeaf } from "obsidian";
import TestPaneComponent from "./TestPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import type { ModuleDev } from "../ModuleDev.ts";
export const VIEW_TYPE_TEST = "ols-pane-test";
//Log view
export class TestPaneView extends ItemView {
    component?: TestPaneComponent;
    plugin: ObsidianLiveSyncPlugin;
    moduleDev: ModuleDev;
    icon = "view-log";
    title: string = "Self-Hosted LiveSync Test and Results";
    navigation = true;

    getIcon(): string {
        return "view-log";
    }

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin, moduleDev: ModuleDev) {
        super(leaf);
        this.plugin = plugin;
        this.moduleDev = moduleDev;
    }

    getViewType() {
        return VIEW_TYPE_TEST;
    }

    getDisplayText() {
        return "Self-Hosted LiveSync Test and Results";
    }

    async onOpen() {
        this.component = new TestPaneComponent({
            target: this.contentEl,
            props: {
                plugin: this.plugin,
                moduleDev: this.moduleDev,
            },
        });
        await Promise.resolve();
    }

    async onClose() {
        this.component?.$destroy();
        await Promise.resolve();
    }
}
