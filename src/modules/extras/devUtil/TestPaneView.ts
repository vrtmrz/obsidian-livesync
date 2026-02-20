import { ItemView, WorkspaceLeaf } from "@/deps.ts";
import TestPaneComponent from "./TestPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import type { ModuleDev } from "../ModuleDev.ts";
export const VIEW_TYPE_TEST = "ols-pane-test";
//Log view
export class TestPaneView extends ItemView {
    component?: TestPaneComponent;
    plugin: ObsidianLiveSyncPlugin;
    moduleDev: ModuleDev;
    override icon = "view-log";
    title: string = "Self-hosted LiveSync Test and Results";
    override navigation = true;

    override getIcon(): string {
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
        return "Self-hosted LiveSync Test and Results";
    }

    override async onOpen() {
        this.component = new TestPaneComponent({
            target: this.contentEl,
            props: {
                plugin: this.plugin,
                moduleDev: this.moduleDev,
            },
        });
        await Promise.resolve();
    }

    override async onClose() {
        this.component?.$destroy();
        await Promise.resolve();
    }
}
