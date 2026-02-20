import { WorkspaceLeaf } from "@/deps.ts";
import LogPaneComponent from "./LogPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { $msg } from "src/lib/src/common/i18n.ts";
import { mount } from "svelte";
export const VIEW_TYPE_LOG = "log-log";
//Log view
export class LogPaneView extends SvelteItemView {
    instantiateComponent(target: HTMLElement) {
        return mount(LogPaneComponent, {
            target: target,
            props: {
                close: () => {
                    this.leaf.detach();
                },
            },
        });
    }

    plugin: ObsidianLiveSyncPlugin;
    override icon = "view-log";
    title: string = "";
    override navigation = false;

    override getIcon(): string {
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
        // TODO: This function is not reactive and does not update the title based on the current language
        return $msg("logPane.title");
    }
}
