import type {
    Confirm,
    ConfirmActionLayout,
} from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import type { UiInteractions, UiNotifications } from "@vrtmrz/ui-interactions";

const DEFAULT_LABELS = {
    confirmationTitle: "Confirmation",
    selectionTitle: "Select",
    yes: "Yes",
    no: "No",
} as const;

export interface UiInteractionsConfirmOptions {
    ui: UiInteractions;
    notifications: UiNotifications;
    createActionAnchor: () => HTMLAnchorElement;
}

function timeoutOption(timeoutSeconds?: number): { timeoutMs?: number } {
    return timeoutSeconds !== undefined && timeoutSeconds > 0
        ? { timeoutMs: timeoutSeconds * 1_000 }
        : {};
}

/** Adapts Commonlib's legacy confirmation contract to Fancy Kit capabilities. */
export class UiInteractionsConfirm implements Confirm {
    readonly notifications: UiNotifications;

    constructor(private readonly options: UiInteractionsConfirmOptions) {
        this.notifications = options.notifications;
    }

    async askYesNo(message: string): Promise<"yes" | "no"> {
        const result = await this.options.ui.confirmAction(
            {
                title: DEFAULT_LABELS.confirmationTitle,
                message,
                actions: ["yes", "no"],
                labels: { yes: DEFAULT_LABELS.yes, no: DEFAULT_LABELS.no },
                defaultAction: "no",
                actionLayout: "vertical",
            },
            "legacy-confirm.ask-yes-no"
        );
        return result === "yes" ? "yes" : "no";
    }

    async askString(
        title: string,
        key: string,
        placeholder: string,
        isPassword = false
    ): Promise<string | false> {
        const prompt = isPassword
            ? this.options.ui.promptPassword.bind(this.options.ui)
            : this.options.ui.promptText.bind(this.options.ui);
        const result = await prompt(
            {
                title,
                label: key,
                placeholder,
            },
            "legacy-confirm.ask-string"
        );
        return result ?? false;
    }

    async askYesNoDialog(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number } = {}
    ): Promise<"yes" | "no"> {
        const result = await this.options.ui.confirmAction(
            {
                title: opt.title ?? DEFAULT_LABELS.confirmationTitle,
                message,
                actions: ["Yes", "No"],
                labels: { Yes: DEFAULT_LABELS.yes, No: DEFAULT_LABELS.no },
                defaultAction: opt.defaultOption ?? "No",
                actionLayout: "vertical",
                ...timeoutOption(opt.timeout),
            },
            "legacy-confirm.ask-yes-no-dialog"
        );
        return result === "Yes" ? "yes" : "no";
    }

    async askSelectString(message: string, items: string[]): Promise<string> {
        const result = await this.options.ui.pickOne(
            {
                items,
                getText: (item) => item,
                placeholder: message,
            },
            "legacy-confirm.ask-select-string"
        );
        return result ?? "";
    }

    async askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        const result = await this.options.ui.confirmAction(
            {
                title: opt.title ?? DEFAULT_LABELS.selectionTitle,
                message,
                actions: buttons,
                defaultAction: opt.defaultAction,
                actionLayout: "vertical",
                ...timeoutOption(opt.timeout),
            },
            "legacy-confirm.ask-select-string-dialogue"
        );
        return result ?? false;
    }

    askInPopup(
        key: string,
        dialogText: string,
        anchorCallback: (anchor: HTMLAnchorElement) => void,
        durationMs?: number
    ): void {
        const anchor = this.options.createActionAnchor();
        anchorCallback(anchor);
        this.options.notifications.show(key, {
            message: dialogText.replace("{HERE}", "").trim(),
            action: {
                label: anchor.textContent?.trim() || "Open",
                onSelect: () => anchor.click(),
            },
            durationMs,
        });
    }

    async confirmWithMessage(
        title: string,
        contentMd: string,
        buttons: string[],
        defaultAction: (typeof buttons)[number],
        timeout?: number,
        actionLayout?: ConfirmActionLayout
    ): Promise<(typeof buttons)[number] | false> {
        const result = await this.options.ui.confirmAction(
            {
                title,
                message: contentMd,
                actions: buttons,
                defaultAction,
                actionLayout: actionLayout ?? "vertical",
                ...timeoutOption(timeout),
            },
            "legacy-confirm.confirm-with-message"
        );
        return result ?? false;
    }
}
