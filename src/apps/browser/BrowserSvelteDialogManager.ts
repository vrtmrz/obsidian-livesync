import {
    type ComponentHasResult,
    SvelteDialogManagerBase,
} from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";
import { createNativeElement } from "@/apps/browserDom";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { SvelteDialogManagerDependencies } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";
import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import DialogHost from "@/modules/services/LiveSyncUI/DialogHost.svelte";
import { SvelteDialogSession } from "@/modules/services/SvelteDialogSession";

export class BrowserModal {
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    modalEl: HTMLElement;
    isOpen: boolean = false;
    baseEl: HTMLElement;
    constructor() {
        const baseEl = createNativeElement(_activeDocument, "popup");
        this.baseEl = baseEl;
        this.contentEl = createNativeElement(_activeDocument, "div");
        this.contentEl.className = "modal-content";
        this.titleEl = createNativeElement(_activeDocument, "div");
        this.titleEl.className = "modal-title";
        this.modalEl = createNativeElement(_activeDocument, "div");
        this.modalEl.className = "modal";
        this.modalEl.hidden = true;
        this.modalEl.appendChild(this.titleEl);
        this.modalEl.appendChild(this.contentEl);
        this.baseEl.appendChild(this.modalEl);
    }
    open() {
        this.isOpen = true;
        this.modalEl.hidden = false;
        if (!this.baseEl.parentElement) {
            _activeDocument.body.appendChild(this.baseEl);
        }
        this.onOpen();
    }
    close() {
        this.isOpen = false;
        this.modalEl.hidden = true;
        this.baseEl.remove();
        this.onClose();
    }
    onOpen() {}
    onClose() {}
    setTitle(t: string) {
        this.titleEl.textContent = t;
    }
}

export class LiveSyncBrowserDialog<T, U, C extends ServiceContext = ServiceContext> extends BrowserModal {
    private readonly session: SvelteDialogSession<T, U, C>;

    constructor(
        context: C,
        dependents: SvelteDialogManagerDependencies<C>,
        component: ComponentHasResult<T, U>,
        initialData?: U
    ) {
        super();
        this.session = new SvelteDialogSession({
            surface: this,
            context,
            dependencies: dependents,
            dialogHost: DialogHost,
            component,
            initialData,
        });
    }

    override onOpen(): void {
        this.session.onOpen();
    }

    override onClose(): void {
        this.session.onClose();
    }

    waitForClose(): Promise<T | undefined> {
        return this.session.waitForClose();
    }
}
export class BrowserSvelteDialogManager<T extends ServiceContext> extends SvelteDialogManagerBase<T> {
    override async openSvelteDialog<TT, TU>(
        component: ComponentHasResult<TT, TU>,
        initialData?: TU
    ): Promise<TT | undefined> {
        const dialog = new LiveSyncBrowserDialog<TT, TU, T>(this.context, this.dependents, component, initialData);
        dialog.open();
        return await dialog.waitForClose();
    }
}
