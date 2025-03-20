import { WorkspaceLeaf } from "../../../deps.ts";
import GlobalHistoryComponent from "./GlobalHistory.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";

export const VIEW_TYPE_GLOBAL_HISTORY = "global-history";
export class GlobalHistoryView extends SvelteItemView {
    instantiateComponent(target: HTMLElement) {
        return mount(GlobalHistoryComponent, {
            target: target,
            props: {
                plugin: this.plugin,
            },
        });
    }

    plugin: ObsidianLiveSyncPlugin;
    icon = "clock";
    title: string = "";
    navigation = true;

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
}
