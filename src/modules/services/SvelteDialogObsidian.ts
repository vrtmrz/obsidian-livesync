import { Modal } from "@/deps";

import {
    SvelteDialogManagerBase,
    type ComponentHasResult,
    type SvelteDialogManagerDependencies,
} from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import DialogHost from "@/modules/services/LiveSyncUI/DialogHost.svelte";
import { SvelteDialogSession } from "@/modules/services/SvelteDialogSession";

export class SvelteDialogObsidian<T, U, C extends ObsidianServiceContext = ObsidianServiceContext> extends Modal {
    private readonly session: SvelteDialogSession<T, U, C>;

    constructor(
        context: C,
        dependents: SvelteDialogManagerDependencies<C>,
        component: ComponentHasResult<T, U>,
        initialData?: U
    ) {
        super(context.app);
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
        this.contentEl.closest(".modal-container")?.classList.add("livesync-svelte-dialog-container");
    }

    override onClose(): void {
        this.session.onClose();
    }

    waitForClose(): Promise<T | undefined> {
        return this.session.waitForClose();
    }
}

export class ObsidianSvelteDialogManager<T extends ObsidianServiceContext> extends SvelteDialogManagerBase<T> {
    override async openSvelteDialog<TT, TU>(
        component: ComponentHasResult<TT, TU>,
        initialData?: TU
    ): Promise<TT | undefined> {
        const dialog = new SvelteDialogObsidian<TT, TU, T>(this.context, this.dependents, component, initialData);
        dialog.open();
        return await dialog.waitForClose();
    }
}
