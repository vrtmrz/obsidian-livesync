// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { ItemView, WorkspaceLeaf } from "@/deps.ts";
import TestPaneComponent from "./TestPane.svelte";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import type { ModuleDev } from "@/modules/extras/ModuleDev.ts";
export declare const VIEW_TYPE_TEST = "ols-pane-test";
declare global {
    interface LSEvents {
        "debug-sync-status": string[];
    }
}
export declare class TestPaneView extends ItemView {
    component?: TestPaneComponent;
    plugin: ObsidianLiveSyncPlugin;
    moduleDev: ModuleDev;
    icon: string;
    title: string;
    navigation: boolean;
    getIcon(): string;
    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin, moduleDev: ModuleDev);
    getViewType(): string;
    getDisplayText(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
}
