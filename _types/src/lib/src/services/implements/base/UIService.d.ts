// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { Confirm } from "@lib/interfaces/Confirm";
import type { ComponentHasResult, SvelteDialogManagerBase } from "@lib/UI/svelteDialog";
import type { IAPIService, IUIService } from "@lib/services/base/IService";
import { type AppLifecycleService } from "@lib/services/base/AppLifecycleService.ts";
import { ServiceBase, type ServiceContext } from "@lib/services/base/ServiceBase";
export type UIServiceDependencies<T extends ServiceContext = ServiceContext> = {
    appLifecycle: AppLifecycleService<T>;
    dialogManager: SvelteDialogManagerBase<T>;
    APIService: IAPIService;
};
type DialogResult = "ok" | "cancel";
type DialogParams = {
    title: string;
    dataToCopy: string;
};
export declare abstract class UIService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IUIService {
    private _dialogManager;
    protected _APIService: IAPIService;
    abstract get dialogToCopy(): ComponentHasResult<DialogResult, DialogParams>;
    constructor(context: T, dependents: UIServiceDependencies<T>);
    get dialogManager(): SvelteDialogManagerBase<T>;
    promptCopyToClipboard(title: string, value: string): Promise<boolean>;
    showMarkdownDialog<T extends string[]>(title: string, contentMD: string, buttons: T, defaultAction?: (typeof buttons)[number]): Promise<(typeof buttons)[number] | false>;
    get confirm(): Confirm;
}
export {};
