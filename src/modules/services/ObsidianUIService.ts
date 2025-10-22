import { UIService } from "../../lib/src/services/Services";
import type ObsidianLiveSyncPlugin from "../../main";
import { SvelteDialogManager } from "../features/SetupWizard/ObsidianSvelteDialog";
import DialogueToCopy from "../../lib/src/UI/dialogues/DialogueToCopy.svelte";

export class ObsidianUIService extends UIService {
    private _dialogManager: SvelteDialogManager;
    private _plugin: ObsidianLiveSyncPlugin;
    get dialogManager() {
        return this._dialogManager;
    }
    constructor(plugin: ObsidianLiveSyncPlugin) {
        super();
        this._dialogManager = new SvelteDialogManager(plugin);
        this._plugin = plugin;
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
        return this._plugin.confirm.askSelectStringDialogue(contentMD, buttons, {
            title,
            defaultAction: defaultAction ?? buttons[0],
            timeout: 0,
        });
    }
}
