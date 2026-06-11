import { WorkspaceLeaf } from "@/deps.ts";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
export declare const VIEW_TYPE_LOG = "log-log";
export declare class LogPaneView extends SvelteItemView {
    instantiateComponent(target: HTMLElement): {
        $on?(type: string, callback: (e: any) => void): () => void;
        $set?(props: Partial<Record<string, any>>): void;
    } & Record<string, any>;
    plugin: ObsidianLiveSyncPlugin;
    icon: string;
    title: string;
    navigation: boolean;
    getIcon(): string;
    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin);
    getViewType(): string;
    getDisplayText(): import("octagonal-wheels/common/types").TaggedType<string, "logPane.title">;
}
