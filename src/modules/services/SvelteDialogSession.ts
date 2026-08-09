import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import {
    setupDialogContext,
    type ComponentHasResult,
    type DialogContext,
    type DialogHostProps,
    type DialogSvelteComponentBaseProps,
    type SvelteDialogManagerDependencies,
} from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";
import { fireAndForget, promiseWithResolvers, type PromiseWithResolvers } from "octagonal-wheels/promises";
import { mount, unmount, type Component } from "svelte";

/** Host dialogue surface controlled by an explicit session. */
export interface SvelteDialogSurface {
    readonly contentEl: HTMLElement;
    setTitle(title: string): unknown;
    close(): void;
}

type MountedDialog = ReturnType<typeof mount>;

/** Injectable renderer used to keep the dialogue lifecycle independently testable. */
export interface SvelteDialogRenderer {
    mount(dialogHost: Component<DialogHostProps>, target: HTMLElement, props: DialogHostProps): MountedDialog;
    unmount(component: MountedDialog): Promise<void>;
}

export interface SvelteDialogSessionOptions<TResult, TInitial, TContext extends ServiceContext> {
    surface: SvelteDialogSurface;
    context: TContext;
    dependencies: SvelteDialogManagerDependencies<TContext>;
    dialogHost: Component<DialogHostProps>;
    component: ComponentHasResult<TResult, TInitial>;
    initialData?: TInitial;
    renderer?: SvelteDialogRenderer;
}

const svelteDialogRenderer: SvelteDialogRenderer = {
    mount(dialogHost, target, props) {
        return mount(dialogHost, { target, props });
    },
    async unmount(component) {
        await unmount(component);
    },
};

/** Owns one Svelte dialogue result and mount lifecycle for a concrete host surface. */
export class SvelteDialogSession<
    TResult,
    TInitial,
    TContext extends ServiceContext = ServiceContext,
> {
    private readonly surface: SvelteDialogSurface;
    private readonly context: TContext;
    private readonly dependencies: SvelteDialogManagerDependencies<TContext>;
    private readonly dialogHost: Component<DialogHostProps>;
    private readonly component: ComponentHasResult<TResult, TInitial>;
    private readonly initialData?: TInitial;
    private readonly renderer: SvelteDialogRenderer;

    private result?: TResult;
    private pendingResult?: PromiseWithResolvers<TResult | undefined>;
    private mountedDialog?: MountedDialog;
    private unregisterUnload?: () => void;

    constructor(options: SvelteDialogSessionOptions<TResult, TInitial, TContext>) {
        this.surface = options.surface;
        this.context = options.context;
        this.dependencies = options.dependencies;
        this.dialogHost = options.dialogHost;
        this.component = options.component;
        this.initialData = options.initialData;
        this.renderer = options.renderer ?? svelteDialogRenderer;
    }

    onOpen(): void {
        this.surface.contentEl.replaceChildren();
        this.unregisterUnload?.();
        this.unregisterUnload = undefined;
        if (this.pendingResult) {
            this.pendingResult.reject(new Error("Dialogue opened again"));
        }

        this.result = undefined;
        const pendingResult = promiseWithResolvers<TResult | undefined>();
        this.pendingResult = pendingResult;
        this.unregisterUnload = this.context.events.onceEvent(EVENT_PLUGIN_UNLOADED, () => {
            if (this.pendingResult !== pendingResult) {
                return;
            }
            this.pendingResult = undefined;
            pendingResult.reject(new Error("Plug-in unloaded"));
            this.surface.close();
        });

        this.mountedDialog = this.renderer.mount(this.dialogHost, this.surface.contentEl, {
            onSetupContext: (props: DialogSvelteComponentBaseProps<TResult, TInitial>) => {
                setupDialogContext({
                    ...props,
                    context: this.context,
                    services: this.dependencies,
                } satisfies DialogContext<TContext, TResult, TInitial>);
            },
            setTitle: (title: string) => {
                this.surface.setTitle(title);
            },
            closeDialog: () => {
                this.surface.close();
            },
            setResult: (result: TResult) => {
                this.result = result;
            },
            getInitialData: () => this.initialData,
            mountComponent: this.component,
        });
    }

    waitForClose(): Promise<TResult | undefined> {
        if (!this.pendingResult) {
            throw new Error("Dialogue has not been opened");
        }
        return this.pendingResult.promise;
    }

    onClose(): void {
        this.unregisterUnload?.();
        this.unregisterUnload = undefined;
        this.pendingResult?.resolve(this.result);
        this.pendingResult = undefined;

        const mountedDialog = this.mountedDialog;
        this.mountedDialog = undefined;
        if (mountedDialog) {
            fireAndForget(() => this.renderer.unmount(mountedDialog));
        }
    }
}
