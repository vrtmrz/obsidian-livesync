// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { App, Modal } from "@/deps.ts";
import { type FilePath, type LoadedEntry } from "@lib/common/types.ts";
import { mount } from "svelte";
export declare class JsonResolveModal extends Modal {
    filename: FilePath;
    callback?: (keepRev?: string, mergedStr?: string) => Promise<void>;
    docs: LoadedEntry[];
    component?: ReturnType<typeof mount>;
    nameA: string;
    nameB: string;
    defaultSelect: string;
    keepOrder: boolean;
    hideLocal: boolean;
    title: string;
    constructor(app: App, filename: FilePath, docs: LoadedEntry[], callback: (keepRev?: string, mergedStr?: string) => Promise<void>, nameA?: string, nameB?: string, defaultSelect?: string, keepOrder?: boolean, hideLocal?: boolean, title?: string);
    UICallback(keepRev?: string, mergedStr?: string): Promise<void>;
    onOpen(): void;
    onClose(): void;
}
