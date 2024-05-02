import {
    ItemView,
    WorkspaceLeaf
} from "../deps.ts";
import GlobalHistoryComponent from "./GlobalHistory.svelte";
import type ObsidianLiveSyncPlugin from "../main.ts";

export const VIEW_TYPE_GLOBAL_HISTORY = "global-history";
export class GlobalHistoryView extends ItemView {

    component: GlobalHistoryComponent;
    plugin: ObsidianLiveSyncPlugin;
    icon: "clock";
    title: string;
    navigation: true;

    getIcon(): string {
        return "clock";
    }

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }


    getViewType() {
        return VIEW_TYPE_GLOBAL_HISTORY;
    }

    getDisplayText() {
        return "Vault history";
    }

    // eslint-disable-next-line require-await
    async onOpen() {
        this.component = new GlobalHistoryComponent({
            target: this.contentEl,
            props: {
                plugin: this.plugin,
            },
        });
    }

    // eslint-disable-next-line require-await
    async onClose() {
        this.component.$destroy();
    }
}
