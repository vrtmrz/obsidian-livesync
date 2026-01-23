// ModuleInputUIObsidian.ts
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { disposeMemoObject, memoIfNotExist, memoObject, retrieveMemoObject } from "../../common/utils.ts";
import {
    askSelectString,
    askString,
    askYesNo,
    confirmWithMessage,
    confirmWithMessageWithWideButton,
} from "./UILib/dialogs.ts";
import { Notice } from "../../deps.ts";
import type { Confirm } from "../../lib/src/interfaces/Confirm.ts";
import { setConfirmInstance } from "../../lib/src/PlatformAPIs/obsidian/Confirm.ts";
import { $msg } from "src/lib/src/common/i18n.ts";
import type { LiveSyncCore } from "../../main.ts";

// This module cannot be a common module because it depends on Obsidian's API.
// However, we have to make compatible one for other platform.

export class ModuleInputUIObsidian extends AbstractObsidianModule implements Confirm {
    private _everyOnload(): Promise<boolean> {
        this.core.confirm = this;
        setConfirmInstance(this);
        return Promise.resolve(true);
    }

    askYesNo(message: string): Promise<"yes" | "no"> {
        return askYesNo(this.app, message);
    }
    askString(title: string, key: string, placeholder: string, isPassword: boolean = false): Promise<string | false> {
        return askString(this.app, title, key, placeholder, isPassword);
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
            this.plugin,
            opt.title || defaultTitle,
            message,
            [yesLabel, noLabel],
            defaultOption,
            opt.timeout
        );
        return ret === yesLabel ? "yes" : "no";
    }

    askSelectString(message: string, items: string[]): Promise<string> {
        return askSelectString(this.app, message, items);
    }

    askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        const defaultTitle = $msg("moduleInputUIObsidian.defaultTitleSelect");
        return confirmWithMessageWithWideButton(
            this.plugin,
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
        return confirmWithMessage(this.plugin, title, contentMd, buttons, defaultAction, timeout);
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onLoaded.addHandler(this._everyOnload.bind(this));
    }
}
