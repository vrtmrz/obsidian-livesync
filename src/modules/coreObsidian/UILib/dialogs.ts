import { ButtonComponent } from "@/deps.ts";
import { App, FuzzySuggestModal, MarkdownRenderer, Modal, Plugin, Setting, Component } from "@/deps.ts";
import { EVENT_PLUGIN_UNLOADED, eventHub } from "@/common/events.ts";
import { compatGlobal, type CompatIntervalHandle } from "@lib/common/coreEnvFunctions.ts";

class AutoClosableModal extends Modal {
    _closeByUnload() {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        eventHub.off(EVENT_PLUGIN_UNLOADED, this._closeByUnload);
        this.close();
    }

    constructor(app: App) {
        super(app);
        this._closeByUnload = this._closeByUnload.bind(this);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        eventHub.once(EVENT_PLUGIN_UNLOADED, this._closeByUnload);
    }
    override onClose() {
        // eslint-disable-next-line @typescript-eslint/unbound-method
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

    override onOpen() {
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

    override onClose() {
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
    _app: App;
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
        this._app = app;
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
    override onClose(): void {
        compatGlobal.setTimeout(() => {
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
    timer: CompatIntervalHandle | undefined = undefined;
    defaultButtonComponent: ButtonComponent | undefined;
    wideButton: boolean;

    onSubmit: (result: string | false) => void;
    component: Component = new Component();

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
            this.timer = compatGlobal.setInterval(() => {
                if (this.timeout === undefined) return;
                this.timeout--;
                if (this.timeout < 0) {
                    if (this.timer) {
                        compatGlobal.clearInterval(this.timer);
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

    override onOpen() {
        this.component.load();
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        const div = contentEl.createDiv();
        div.setCssStyles({
            userSelect: "text",
            webkitUserSelect: "text",
        });
        void MarkdownRenderer.render(this.plugin.app, this.contentMd, div, "/", this.component);
        const buttonSetting = new Setting(contentEl);
        const labelWrapper = contentEl.createDiv();
        labelWrapper.addClass("sls-dialogue-note-wrapper");
        const labelEl = labelWrapper.createEl("label", { text: "To stop the countdown, tap anywhere on the dialogue" });
        labelEl.addClass("sls-dialogue-note-countdown");
        if (!this.timeout || !this.timer) {
            labelWrapper.empty();
            labelWrapper.setCssStyles({ display: "none" });
        }

        buttonSetting.infoEl.setCssStyles({ display: "none" });
        buttonSetting.controlEl.setCssStyles({ flexWrap: "wrap" });
        if (this.wideButton) {
            buttonSetting.controlEl.setCssStyles({
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                flexGrow: "1",
            });
        }
        contentEl.addEventListener("click", () => {
            if (this.timer) {
                labelWrapper.empty();
                labelWrapper.setCssStyles({ display: "none" });
                compatGlobal.clearInterval(this.timer);
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
                        compatGlobal.clearInterval(this.timer);
                        this.timer = undefined;
                    }
                    this.close();
                });
                if (button == this.defaultAction) {
                    this.defaultButtonComponent = btn;
                    btn.setCta();
                }
                if (this.wideButton) {
                    btn.buttonEl.setCssStyles({
                        flexGrow: "1",
                        width: "100%",
                    });
                }
                return btn;
            });
        }
    }

    override onClose() {
        super.onClose();
        this.component.unload();
        const { contentEl } = this;
        contentEl.empty();
        if (this.timer) {
            compatGlobal.clearInterval(this.timer);
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
