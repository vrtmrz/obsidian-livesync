// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { ItemView } from "@/deps.ts";
import { type mount } from "svelte";
export declare abstract class SvelteItemView extends ItemView {
    abstract instantiateComponent(target: HTMLElement): ReturnType<typeof mount> | Promise<ReturnType<typeof mount>>;
    component?: ReturnType<typeof mount>;
    onOpen(): Promise<void>;
    _dismountComponent(): Promise<void>;
    onClose(): Promise<void>;
}
