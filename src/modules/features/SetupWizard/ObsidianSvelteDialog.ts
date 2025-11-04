import { eventHub, EVENT_PLUGIN_UNLOADED } from "@/common/events";
import { Modal } from "@/deps";
import type ObsidianLiveSyncPlugin from "@/main";
import { mount, unmount } from "svelte";
import DialogHost from "@lib/UI/DialogHost.svelte";
import { fireAndForget, promiseWithResolvers, type PromiseWithResolvers } from "octagonal-wheels/promises";
import { LOG_LEVEL_NOTICE, Logger } from "octagonal-wheels/common/logger";
import {
    type DialogControlBase,
    type DialogSvelteComponentBaseProps,
    type ComponentHasResult,
    setupDialogContext,
    getDialogContext,
    type SvelteDialogManagerBase,
} from "@/lib/src/UI/svelteDialog.ts";

export type DialogSvelteComponentProps = DialogSvelteComponentBaseProps & {
    plugin: ObsidianLiveSyncPlugin;
    services: ObsidianLiveSyncPlugin["services"];
};

export type DialogControls<T = any, U = any> = DialogControlBase<T, U> & {
    plugin: ObsidianLiveSyncPlugin;
    services: ObsidianLiveSyncPlugin["services"];
};

export type DialogMessageProps = Record<string, any>;
// type DialogSvelteComponent<T extends DialogSvelteComponentProps = DialogSvelteComponentProps> = Component<SvelteComponent<T>,any>;

export class SvelteDialog<T, U> extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    mountedComponent?: ReturnType<typeof mount>;
    component: ComponentHasResult<T, U>;
    result?: T;
    initialData?: U;
    title: string = "Obsidian LiveSync - Setup Wizard";
    constructor(plugin: ObsidianLiveSyncPlugin, component: ComponentHasResult<T, U>, initialData?: U) {
        super(plugin.app);
        this.plugin = plugin;
        this.component = component;
        this.initialData = initialData;
    }
    resolveResult() {
        this.resultPromiseWithResolvers?.resolve(this.result);
        this.resultPromiseWithResolvers = undefined;
    }
    resultPromiseWithResolvers?: PromiseWithResolvers<T | undefined>;
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const dialog = this;

        if (this.resultPromiseWithResolvers) {
            this.resultPromiseWithResolvers.reject("Dialog opened again");
        }
        const pr = promiseWithResolvers<any>();
        eventHub.once(EVENT_PLUGIN_UNLOADED, () => {
            if (this.resultPromiseWithResolvers === pr) {
                pr.reject("Plugin unloaded");
                this.close();
            }
        });
        this.resultPromiseWithResolvers = pr;
        this.mountedComponent = mount(DialogHost, {
            target: contentEl,
            props: {
                onSetupContext: (props: DialogSvelteComponentBaseProps) => {
                    setupDialogContext({
                        ...props,
                        plugin: this.plugin,
                        services: this.plugin.services,
                    });
                },
                setTitle: (title: string) => {
                    dialog.setTitle(title);
                },
                closeDialog: () => {
                    dialog.close();
                },
                setResult: (result: T) => {
                    this.result = result;
                },
                getInitialData: () => this.initialData,
                mountComponent: this.component,
            },
        });
    }
    waitForClose(): Promise<T | undefined> {
        if (!this.resultPromiseWithResolvers) {
            throw new Error("Dialog not opened yet");
        }
        return this.resultPromiseWithResolvers.promise;
    }
    onClose() {
        this.resolveResult();
        fireAndForget(async () => {
            if (this.mountedComponent) {
                await unmount(this.mountedComponent);
            }
        });
    }
}

export async function openSvelteDialog<T, U>(
    plugin: ObsidianLiveSyncPlugin,
    component: ComponentHasResult<T, U>,
    initialData?: U
): Promise<T | undefined> {
    const dialog = new SvelteDialog<T, U>(plugin, component, initialData);
    dialog.open();

    return await dialog.waitForClose();
}

export class SvelteDialogManager implements SvelteDialogManagerBase {
    plugin: ObsidianLiveSyncPlugin;
    constructor(plugin: ObsidianLiveSyncPlugin) {
        this.plugin = plugin;
    }
    async open<T, U>(component: ComponentHasResult<T, U>, initialData?: U): Promise<T | undefined> {
        return await openSvelteDialog<T, U>(this.plugin, component, initialData);
    }
    async openWithExplicitCancel<T, U>(component: ComponentHasResult<T, U>, initialData?: U): Promise<T> {
        for (let i = 0; i < 10; i++) {
            const ret = await openSvelteDialog<T, U>(this.plugin, component, initialData);
            if (ret !== undefined) {
                return ret;
            }
            if (this.plugin.services.appLifecycle.hasUnloaded()) {
                throw new Error("Operation cancelled due to app shutdown.");
            }
            Logger("Please select 'Cancel' explicitly to cancel this operation.", LOG_LEVEL_NOTICE);
        }
        throw new Error("Operation Forcibly cancelled by user.");
    }
}

export function getObsidianDialogContext<T = any>(): DialogControls<T> {
    return getDialogContext<T>() as DialogControls<T>;
}
