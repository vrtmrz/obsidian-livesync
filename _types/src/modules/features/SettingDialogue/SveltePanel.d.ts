// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type Component } from "svelte";
import { type Writable } from "svelte/store";
/**
 * Props passed to Svelte panels, containing a writable port
 * to communicate with the panel
 */
export type SveltePanelProps<T = unknown> = {
    port: Writable<T | undefined>;
};
/**
 * A class to manage a Svelte panel within Obsidian
 * Especially useful for settings panels
 */
export declare class SveltePanel<T = unknown> {
    private _mountedComponent;
    private _componentValue;
    /**
     * Creates a Svelte panel instance
     * @param component Component to mount
     * @param mountTo HTMLElement to mount the component to
     * @param valueStore Optional writable store to bind to the component's port, if not provided a new one will be created
     * @returns The SveltePanel instance
     */
    constructor(component: Component<SveltePanelProps<T>>, mountTo: HTMLElement, valueStore?: Writable<T>);
    /**
     * Destroys the Svelte panel instance by unmounting the component
     */
    destroy(): void;
    /**
     * Gets or sets the current value of the component's port
     */
    get componentValue(): T | undefined;
    set componentValue(value: T | undefined);
}
