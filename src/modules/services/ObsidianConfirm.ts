import { type App, type Plugin, Notice } from "@/deps";
import { scheduleTask, memoIfNotExist, memoObject, retrieveMemoObject, disposeMemoObject } from "@/common/utils";
import { EVENT_PLUGIN_UNLOADED } from "@/common/events";
import { $msg } from "@/common/translation";
import type { Confirm, ConfirmActionLayout } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import { confirmAction, pickOne, promptPassword, promptText } from "@vrtmrz/obsidian-plugin-kit";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import { confirmWithMessageWithWideButton } from "@/modules/coreObsidian/UILib/dialogs";

export class ObsidianConfirm<T extends ObsidianServiceContext = ObsidianServiceContext> implements Confirm {
    private _context: T;
    private readonly dialogueController = new AbortController();
    private readonly popupKeys = new Set<string>();
    get _app(): App {
        return this._context.app;
    }
    get _plugin(): Plugin {
        return this._context.plugin;
    }
    constructor(context: T) {
        this._context = context;
        context.events.onceEvent(EVENT_PLUGIN_UNLOADED, () => {
            this.dialogueController.abort();
            for (const popupKey of this.popupKeys) {
                this.closePopup(popupKey);
            }
        });
    }

    private get dialogueLifecycle() {
        return { signal: this.dialogueController.signal };
    }

    private hasCountdown(timeout: number | undefined): timeout is number {
        return timeout !== undefined && timeout > 0;
    }

    async askYesNo(message: string): Promise<"yes" | "no"> {
        const result = await confirmAction(
            this._app,
            {
                title: $msg("moduleInputUIObsidian.defaultTitleConfirmation"),
                message,
                actions: ["yes", "no"] as const,
                labels: {
                    yes: $msg("moduleInputUIObsidian.optionYes"),
                    no: $msg("moduleInputUIObsidian.optionNo"),
                },
                actionLayout: "vertical",
                defaultAction: "no",
                sourcePath: "/",
            },
            this.dialogueLifecycle
        );
        return result === "yes" ? "yes" : "no";
    }

    async askString(
        title: string,
        key: string,
        placeholder: string,
        isPassword: boolean = false
    ): Promise<string | false> {
        const prompt = isPassword ? promptPassword : promptText;
        const result = await prompt(
            this._app,
            {
                title,
                label: key,
                placeholder,
            },
            this.dialogueLifecycle
        );
        return result ?? false;
    }

    async askYesNoDialog(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number } = { title: "Confirmation" }
    ): Promise<"yes" | "no"> {
        const defaultTitle = $msg("moduleInputUIObsidian.defaultTitleConfirmation");
        const yesLabel = $msg("moduleInputUIObsidian.optionYes");
        const noLabel = $msg("moduleInputUIObsidian.optionNo");
        const defaultOption = opt.defaultOption === "Yes" ? yesLabel : noLabel;
        if (!this.hasCountdown(opt.timeout)) {
            const result = await confirmAction(
                this._app,
                {
                    title: opt.title || defaultTitle,
                    message,
                    actions: ["Yes", "No"] as const,
                    labels: { Yes: yesLabel, No: noLabel },
                    actionLayout: "vertical",
                    defaultAction: opt.defaultOption === "Yes" ? "Yes" : "No",
                    sourcePath: "/",
                },
                this.dialogueLifecycle
            );
            return result === "Yes" ? "yes" : "no";
        }
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

    async askSelectString(message: string, items: string[]): Promise<string> {
        const result = await pickOne(
            this._app,
            {
                items,
                getText: (item) => item,
                placeholder: message,
            },
            this.dialogueLifecycle
        );
        return result ?? "";
    }

    async askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        const defaultTitle = $msg("moduleInputUIObsidian.defaultTitleSelect");
        // Commonlib owns the transport decision, while LiveSync owns the
        // concrete Obsidian view which lets users revise that decision.
        const presentedMessage =
            opt.title === "P2P Connection Request"
                ? message.replace("Peer-to-Peer Replicator Pane", $msg("P2P Status pane"))
                : message;
        if (!this.hasCountdown(opt.timeout)) {
            const result = await confirmAction(
                this._app,
                {
                    title: opt.title || defaultTitle,
                    message: presentedMessage,
                    actions: buttons,
                    actionLayout: "vertical",
                    defaultAction: opt.defaultAction,
                    sourcePath: "/",
                },
                this.dialogueLifecycle
            );
            return result ?? false;
        }
        return confirmWithMessageWithWideButton(
            this._plugin,
            opt.title || defaultTitle,
            presentedMessage,
            buttons,
            opt.defaultAction,
            opt.timeout
        );
    }

    askInPopup(
        key: string,
        dialogText: string,
        anchorCallback: (anchor: HTMLAnchorElement) => void,
        durationMs: number = 20000
    ) {
        const popupKey = "popup-" + key;
        this.popupKeys.add(popupKey);
        const fragment = createFragment((doc) => {
            const [beforeText, afterText] = dialogText.split("{HERE}", 2);
            doc.createSpan(undefined, (a) => {
                a.appendText(beforeText);
                a.appendChild(
                    a.createEl("a", undefined, (anchor) => {
                        anchorCallback(anchor);
                        anchor.addEventListener("click", () => this.closePopup(popupKey));
                    })
                );
                a.appendText(afterText);
            });
        });
        scheduleTask(popupKey, 1000, async () => {
            if (this.dialogueController.signal.aborted) {
                this.popupKeys.delete(popupKey);
                return;
            }
            const popup = await memoIfNotExist(popupKey, () => new Notice(fragment, 0));
            const isShown = popup?.noticeEl?.isShown();
            if (!isShown) {
                memoObject(popupKey, new Notice(fragment, 0));
            }
            scheduleTask(popupKey + "-close", durationMs, () => this.closePopup(popupKey));
        });
    }

    private closePopup(popupKey: string) {
        const popup = retrieveMemoObject<Notice>(popupKey);
        if (!popup) {
            this.popupKeys.delete(popupKey);
            return;
        }
        if (popup.noticeEl?.isShown()) {
            popup.hide();
        }
        disposeMemoObject(popupKey);
        this.popupKeys.delete(popupKey);
    }

    async confirmWithMessage(
        title: string,
        contentMd: string,
        buttons: string[],
        defaultAction: (typeof buttons)[number],
        timeout?: number,
        actionLayout?: ConfirmActionLayout
    ): Promise<(typeof buttons)[number] | false> {
        if (this.hasCountdown(timeout)) {
            return confirmWithMessageWithWideButton(this._plugin, title, contentMd, buttons, defaultAction, timeout);
        }
        const result = await confirmAction(
            this._app,
            {
                title,
                message: contentMd,
                actions: buttons,
                defaultAction,
                sourcePath: "/",
                actionLayout: actionLayout ?? "vertical",
            },
            this.dialogueLifecycle
        );
        return result ?? false;
    }
}
