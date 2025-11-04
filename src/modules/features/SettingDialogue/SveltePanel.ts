import { mount, type Component, unmount } from "svelte";
import { type Writable, writable, get } from "svelte/store";

/**
 * Props passed to Svelte panels, containing a writable port
 * to communicate with the panel
 */
export type SveltePanelProps<T = any> = {
    port: Writable<T | undefined>;
};

/**
 * A class to manage a Svelte panel within Obsidian
 * Especially useful for settings panels
 */
export class SveltePanel<T = any> {
    private _mountedComponent: ReturnType<typeof mount>;
    private _componentValue = writable<T | undefined>(undefined);
    /**
     * Creates a Svelte panel instance
     * @param component Component to mount
     * @param mountTo HTMLElement to mount the component to
     * @param valueStore Optional writable store to bind to the component's port, if not provided a new one will be created
     * @returns The SveltePanel instance
     */
    constructor(component: Component<SveltePanelProps<T>>, mountTo: HTMLElement, valueStore?: Writable<T>) {
        this._componentValue = valueStore ?? writable<T | undefined>(undefined);
        this._mountedComponent = mount(component, {
            target: mountTo,
            props: {
                port: this._componentValue,
            },
        });
        return this;
    }
    /**
     * Destroys the Svelte panel instance by unmounting the component
     */
    destroy() {
        if (this._mountedComponent) {
            void unmount(this._mountedComponent);
        }
    }

    /**
     * Gets or sets the current value of the component's port
     */
    get componentValue() {
        return get(this._componentValue);
    }
    set componentValue(value: T | undefined) {
        this._componentValue.set(value);
    }
}
