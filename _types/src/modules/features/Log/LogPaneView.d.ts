import { WorkspaceLeaf } from "@/deps.ts";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
export declare const VIEW_TYPE_LOG = "log-log";
export declare class LogPaneView extends SvelteItemView {
    instantiateComponent(target: HTMLElement): {
        $on?(type: string, callback: (e: any) => void): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
        $set?(props: Partial<Record<string, any>>): void; // eslint-disable-line @typescript-eslint/no-explicit-any
    } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    plugin: ObsidianLiveSyncPlugin;
    icon: string;
    title: string;
    navigation: boolean;
    getIcon(): string;
    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin);
    getViewType(): string;
    getDisplayText(): import("octagonal-wheels/common/types").TaggedType<string, "logPane.title">;
}
