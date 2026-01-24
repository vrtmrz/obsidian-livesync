import { UIService } from "../../lib/src/services/Services";
import { Notice, type App, type Plugin } from "@/deps";
import { SvelteDialogManager } from "../features/SetupWizard/ObsidianSvelteDialog";
import DialogueToCopy from "../../lib/src/UI/dialogues/DialogueToCopy.svelte";
import type { ObsidianServiceContext } from "./ObsidianServices";
import type ObsidianLiveSyncPlugin from "@/main";
import type { Confirm } from "@/lib/src/interfaces/Confirm";
import {
    askSelectString,
    askString,
    askYesNo,
    confirmWithMessage,
    confirmWithMessageWithWideButton,
} from "../coreObsidian/UILib/dialogs";
import { $msg } from "@/lib/src/common/i18n";
import { disposeMemoObject, memoIfNotExist, memoObject, retrieveMemoObject, scheduleTask } from "@/common/utils";
export class ObsidianConfirm implements Confirm {
    private _app: App;
    private _plugin: Plugin;
    constructor(app: App, plugin: Plugin) {
        this._app = app;
        this._plugin = plugin;
    }
    askYesNo(message: string): Promise<"yes" | "no"> {
        return askYesNo(this._app, message);
    }
    askString(title: string, key: string, placeholder: string, isPassword: boolean = false): Promise<string | false> {
        return askString(this._app, title, key, placeholder, isPassword);
    }

    async askYesNoDialog(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number } = { title: "Confirmation" }
    ): Promise<"yes" | "no"> {
        const defaultTitle = $msg("moduleInputUIObsidian.defaultTitleConfirmation");
        const yesLabel = $msg("moduleInputUIObsidian.optionYes");
        const noLabel = $msg("moduleInputUIObsidian.optionNo");
        const defaultOption = opt.defaultOption === "Yes" ? yesLabel : noLabel;
        const ret = await confirmWithMessageWithWideButton(
            this._plugin,
            opt.title || defaultTitle,
            message,
            [yesLabel, noLabel],
            defaultOption,
            opt.timeout
        );
        return ret === yesLabel ? "yes" : "no";
    }

    askSelectString(message: string, items: string[]): Promise<string> {
        return askSelectString(this._app, message, items);
    }

    askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        const defaultTitle = $msg("moduleInputUIObsidian.defaultTitleSelect");
        return confirmWithMessageWithWideButton(
            this._plugin,
            opt.title || defaultTitle,
            message,
            buttons,
            opt.defaultAction,
            opt.timeout
        );
    }

    askInPopup(key: string, dialogText: string, anchorCallback: (anchor: HTMLAnchorElement) => void) {
        const fragment = createFragment((doc) => {
            const [beforeText, afterText] = dialogText.split("{HERE}", 2);
            doc.createEl("span", undefined, (a) => {
                a.appendText(beforeText);
                a.appendChild(
                    a.createEl("a", undefined, (anchor) => {
                        anchorCallback(anchor);
                    })
                );
                a.appendText(afterText);
            });
        });
        const popupKey = "popup-" + key;
        scheduleTask(popupKey, 1000, async () => {
            const popup = await memoIfNotExist(popupKey, () => new Notice(fragment, 0));
            const isShown = popup?.noticeEl?.isShown();
            if (!isShown) {
                memoObject(popupKey, new Notice(fragment, 0));
            }
            scheduleTask(popupKey + "-close", 20000, () => {
                const popup = retrieveMemoObject<Notice>(popupKey);
                if (!popup) return;
                if (popup?.noticeEl?.isShown()) {
                    popup.hide();
                }
                disposeMemoObject(popupKey);
            });
        });
    }

    confirmWithMessage(
        title: string,
        contentMd: string,
        buttons: string[],
        defaultAction: (typeof buttons)[number],
        timeout?: number
    ): Promise<(typeof buttons)[number] | false> {
        return confirmWithMessage(this._plugin, title, contentMd, buttons, defaultAction, timeout);
    }
}
export class ObsidianUIService extends UIService<ObsidianServiceContext> {
    private _dialogManager: SvelteDialogManager;
    private _plugin: Plugin;
    private _liveSyncPlugin: ObsidianLiveSyncPlugin;
    private _confirmInstance: ObsidianConfirm;
    get dialogManager() {
        return this._dialogManager;
    }
    constructor(context: ObsidianServiceContext) {
        super(context);
        this._liveSyncPlugin = context.liveSyncPlugin;
        this._dialogManager = new SvelteDialogManager(this._liveSyncPlugin);
        this._plugin = context.plugin;
        this._confirmInstance = new ObsidianConfirm(this._plugin.app, this._plugin);
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

    get confirm(): Confirm {
        return this._confirmInstance;
    }
}
