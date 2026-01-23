import { UIService } from "../../lib/src/services/Services";
import type { Plugin } from "@/deps";
import { SvelteDialogManager } from "../features/SetupWizard/ObsidianSvelteDialog";
import DialogueToCopy from "../../lib/src/UI/dialogues/DialogueToCopy.svelte";
import type { ObsidianServiceContext } from "./ObsidianServices";
import type ObsidianLiveSyncPlugin from "@/main";

export class ObsidianUIService extends UIService<ObsidianServiceContext> {
    private _dialogManager: SvelteDialogManager;
    private _plugin: Plugin;
    private _liveSyncPlugin: ObsidianLiveSyncPlugin;
    get dialogManager() {
        return this._dialogManager;
    }
    constructor(context: ObsidianServiceContext) {
        super(context);
        this._liveSyncPlugin = context.liveSyncPlugin;
        this._dialogManager = new SvelteDialogManager(this._liveSyncPlugin);
        this._plugin = context.plugin;
    }

    async promptCopyToClipboard(title: string, value: string): Promise<boolean> {
        const param = {
            title: title,
            dataToCopy: value,
        };
        const result = await this._dialogManager.open(DialogueToCopy, param);
        if (result !== "ok") {
            return false;
        }
        return true;
    }

    showMarkdownDialog<T extends string[]>(
        title: string,
        contentMD: string,
        buttons: T,
        defaultAction?: (typeof buttons)[number]
    ): Promise<(typeof buttons)[number] | false> {
        // TODO: implement `confirm` to this service
        return this._liveSyncPlugin.confirm.askSelectStringDialogue(contentMD, buttons, {
            title,
            defaultAction: defaultAction ?? buttons[0],
            timeout: 0,
        });
    }
}
