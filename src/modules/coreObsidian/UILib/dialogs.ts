import { ButtonComponent } from "@/deps.ts";
import { App, FuzzySuggestModal, MarkdownRenderer, Modal, Plugin, Setting } from "../../../deps.ts";
import { EVENT_PLUGIN_UNLOADED, eventHub } from "../../../common/events.ts";

class AutoClosableModal extends Modal {
    _closeByUnload() {
        eventHub.off(EVENT_PLUGIN_UNLOADED, this._closeByUnload);
        this.close();
    }

    constructor(app: App) {
        super(app);
        this._closeByUnload = this._closeByUnload.bind(this);
        eventHub.once(EVENT_PLUGIN_UNLOADED, this._closeByUnload);
    }
    onClose() {
        eventHub.off(EVENT_PLUGIN_UNLOADED, this._closeByUnload);
    }
}

export class InputStringDialog extends AutoClosableModal {
    result: string | false = false;
    onSubmit: (result: string | false) => void;
    title: string;
    key: string;
    placeholder: string;
    isManuallyClosed = false;
    isPassword = false;

    constructor(
        app: App,
        title: string,
        key: string,
        placeholder: string,
        isPassword: boolean,
        onSubmit: (result: string | false) => void
    ) {
        super(app);
        this.onSubmit = onSubmit;
        this.title = title;
        this.placeholder = placeholder;
        this.key = key;
        this.isPassword = isPassword;
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        const formEl = contentEl.createDiv();
        new Setting(formEl)
            .setName(this.key)
            .setClass(this.isPassword ? "password-input" : "normal-input")
            .addText((text) =>
                text.onChange((value) => {
                    this.result = value;
                })
            );
        new Setting(formEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Ok")
                    .setCta()
                    .onClick(() => {
                        this.isManuallyClosed = true;
                        this.close();
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Cancel")
                    .setCta()
                    .onClick(() => {
                        this.close();
                    })
            );
    }

    onClose() {
        super.onClose();
        const { contentEl } = this;
        contentEl.empty();
        if (this.isManuallyClosed) {
            this.onSubmit(this.result);
        } else {
            this.onSubmit(false);
        }
    }
}
export class PopoverSelectString extends FuzzySuggestModal<string> {
    app: App;
    callback: ((e: string) => void) | undefined = () => {};
    getItemsFun: () => string[] = () => {
        return ["yes", "no"];
    };

    constructor(
        app: App,
        note: string,
        placeholder: string | undefined,
        getItemsFun: (() => string[]) | undefined,
        callback: (e: string) => void
    ) {
        super(app);
        this.app = app;
        this.setPlaceholder((placeholder ?? "y/n) ") + note);
        if (getItemsFun) this.getItemsFun = getItemsFun;
        this.callback = callback;
    }

    getItems(): string[] {
        return this.getItemsFun();
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
        // debugger;
        this.callback?.(item);
        this.callback = undefined;
    }
    onClose(): void {
        setTimeout(() => {
            if (this.callback) {
                this.callback("");
                this.callback = undefined;
            }
        }, 100);
    }
}

export class MessageBox<T extends readonly string[]> extends AutoClosableModal {
    plugin: Plugin;
    title: string;
    contentMd: string;
    buttons: T;
    result: string | false = false;
    isManuallyClosed = false;
    defaultAction: string | undefined;
    timeout: number | undefined;
    timer: ReturnType<typeof setInterval> | undefined = undefined;
    defaultButtonComponent: ButtonComponent | undefined;
    wideButton: boolean;

    onSubmit: (result: string | false) => void;

    constructor(
        plugin: Plugin,
        title: string,
        contentMd: string,
        buttons: T,
        defaultAction: T[number],
        timeout: number | undefined,
        wideButton: boolean,
        onSubmit: (result: T[number] | false) => void
    ) {
        super(plugin.app);
        this.plugin = plugin;
        this.title = title;
        this.contentMd = contentMd;
        this.buttons = buttons;
        this.onSubmit = onSubmit;
        this.defaultAction = defaultAction;
        this.timeout = timeout;
        this.wideButton = wideButton;
        if (this.timeout) {
            this.timer = setInterval(() => {
                if (this.timeout === undefined) return;
                this.timeout--;
                if (this.timeout < 0) {
                    if (this.timer) {
                        clearInterval(this.timer);
                        this.defaultButtonComponent?.setButtonText(`${defaultAction}`);
                        this.timer = undefined;
                    }
                    this.result = defaultAction;
                    this.isManuallyClosed = true;
                    this.close();
                } else {
                    this.defaultButtonComponent?.setButtonText(`( ${this.timeout} ) ${defaultAction}`);
                }
            }, 1000);
        }
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        const div = contentEl.createDiv();
        div.style.userSelect = "text";
        div.style["webkitUserSelect"] = "text";
        void MarkdownRenderer.render(this.plugin.app, this.contentMd, div, "/", this.plugin);
        const buttonSetting = new Setting(contentEl);
        const labelWrapper = contentEl.createDiv();
        labelWrapper.addClass("sls-dialogue-note-wrapper");
        const labelEl = labelWrapper.createEl("label", { text: "To stop the countdown, tap anywhere on the dialogue" });
        labelEl.addClass("sls-dialogue-note-countdown");
        if (!this.timeout || !this.timer) {
            labelWrapper.empty();
            labelWrapper.style.display = "none";
        }

        buttonSetting.infoEl.style.display = "none";
        buttonSetting.controlEl.style.flexWrap = "wrap";
        if (this.wideButton) {
            buttonSetting.controlEl.style.flexDirection = "column";
            buttonSetting.controlEl.style.alignItems = "center";
            buttonSetting.controlEl.style.justifyContent = "center";
            buttonSetting.controlEl.style.flexGrow = "1";
        }
        contentEl.addEventListener("click", () => {
            if (this.timer) {
                labelWrapper.empty();
                labelWrapper.style.display = "none";
                clearInterval(this.timer);
                this.timer = undefined;
                this.defaultButtonComponent?.setButtonText(`${this.defaultAction}`);
            }
        });
        for (const button of this.buttons) {
            buttonSetting.addButton((btn) => {
                btn.setButtonText(button).onClick(() => {
                    this.isManuallyClosed = true;
                    this.result = button;
                    if (this.timer) {
                        clearInterval(this.timer);
                        this.timer = undefined;
                    }
                    this.close();
                });
                if (button == this.defaultAction) {
                    this.defaultButtonComponent = btn;
                    btn.setCta();
                }
                if (this.wideButton) {
                    btn.buttonEl.style.flexGrow = "1";
                    btn.buttonEl.style.width = "100%";
                }
                return btn;
            });
        }
    }

    onClose() {
        super.onClose();
        const { contentEl } = this;
        contentEl.empty();
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.isManuallyClosed) {
            this.onSubmit(this.result);
        } else {
            this.onSubmit(false);
        }
    }
}

export function confirmWithMessage<T extends readonly string[]>(
    plugin: Plugin,
    title: string,
    contentMd: string,
    buttons: T,
    defaultAction: T[number],
    timeout?: number
): Promise<T[number] | false> {
    return new Promise((res) => {
        const dialog = new MessageBox(plugin, title, contentMd, buttons, defaultAction, timeout, false, (result) =>
            res(result)
        );
        dialog.open();
    });
}
export function confirmWithMessageWithWideButton<T extends readonly string[]>(
    plugin: Plugin,
    title: string,
    contentMd: string,
    buttons: T,
    defaultAction: T[number],
    timeout?: number
): Promise<T[number] | false> {
    return new Promise((res) => {
        const dialog = new MessageBox(plugin, title, contentMd, buttons, defaultAction, timeout, true, (result) =>
            res(result)
        );
        dialog.open();
    });
}

export const askYesNo = (app: App, message: string): Promise<"yes" | "no"> => {
    return new Promise((res) => {
        const popover = new PopoverSelectString(app, message, undefined, undefined, (result) =>
            res(result as "yes" | "no")
        );
        popover.open();
    });
};

export const askSelectString = (app: App, message: string, items: string[]): Promise<string> => {
    const getItemsFun = () => items;
    return new Promise((res) => {
        const popover = new PopoverSelectString(app, message, "", getItemsFun, (result) => res(result));
        popover.open();
    });
};

export const askString = (
    app: App,
    title: string,
    key: string,
    placeholder: string,
    isPassword: boolean = false
): Promise<string | false> => {
    return new Promise((res) => {
        const dialog = new InputStringDialog(app, title, key, placeholder, isPassword, (result) => res(result));
        dialog.open();
    });
};
