import { Modal } from "@/deps";

import {
    SvelteDialogManagerBase,
    SvelteDialogMixIn,
    type ComponentHasResult,
    type SvelteDialogManagerDependencies,
} from "@lib/services/implements/base/SvelteDialog";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";

export const SvelteDialogBase = SvelteDialogMixIn(Modal);
export class SvelteDialogObsidian<
    T,
    U,
    C extends ObsidianServiceContext = ObsidianServiceContext,
> extends SvelteDialogBase<T, U, C> {
    constructor(
        context: C,
        dependents: SvelteDialogManagerDependencies<C>,
        component: ComponentHasResult<T, U>,
        initialData?: U
    ) {
        super(context.app);
        this.initDialog(context, dependents, component, initialData);
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
