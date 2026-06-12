import { WorkspaceLeaf } from "@/deps.ts";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
export declare const VIEW_TYPE_GLOBAL_HISTORY = "global-history";
export declare class GlobalHistoryView extends SvelteItemView {
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
    getDisplayText(): string;
}
