import { SvelteDialogManagerBase, type ComponentHasResult, type SvelteDialogManagerDependencies } from "@lib/services/implements/base/SvelteDialog";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
export declare const SvelteDialogBase: any;
export declare class SvelteDialogObsidian<T, U, C extends ObsidianServiceContext = ObsidianServiceContext> extends SvelteDialogBase<T, U, C> {
    constructor(context: C, dependents: SvelteDialogManagerDependencies<C>, component: ComponentHasResult<T, U>, initialData?: U);
}
export declare class ObsidianSvelteDialogManager<T extends ObsidianServiceContext> extends SvelteDialogManagerBase<T> {
    openSvelteDialog<TT, TU>(component: ComponentHasResult<TT, TU>, initialData?: TU): Promise<TT | undefined>;
}
