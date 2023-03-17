import { App, FuzzySuggestModal, Modal, Setting } from "./deps";
import ObsidianLiveSyncPlugin from "./main";

//@ts-ignore
import PluginPane from "./PluginPane.svelte";

export class PluginDialogModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    logEl: HTMLDivElement;
    component: PluginPane = null;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        if (this.component == null) {
            this.component = new PluginPane({
                target: contentEl,
                props: { plugin: this.plugin },
            });
        }
    }

    onClose() {
        if (this.component != null) {
            this.component.$destroy();
            this.component = null;
        }
    }
}

export class InputStringDialog extends Modal {
    result: string | false = false;
    onSubmit: (result: string | boolean) => void;
    title: string;
    key: string;
    placeholder: string;
    isManuallyClosed = false;

    constructor(app: App, title: string, key: string, placeholder: string, onSubmit: (result: string | false) => void) {
        super(app);
        this.onSubmit = onSubmit;
        this.title = title;
        this.placeholder = placeholder;
        this.key = key;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h1", { text: this.title });
        // For enter to submit
        const formEl = contentEl.createEl("form");
        new Setting(formEl).setName(this.key).addText((text) =>
            text.onChange((value) => {
                this.result = value;
            })
        );
        new Setting(formEl).addButton((btn) =>
            btn
                .setButtonText("Ok")
                .setCta()
                .onClick(() => {
                    this.isManuallyClosed = true;
                    this.close();
                })
        ).addButton((btn) =>
            btn
                .setButtonText("Cancel")
                .setCta()
                .onClick(() => {
                    this.close();
                })
        );
    }

    onClose() {
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
    callback: (e: string) => void = () => { };
    getItemsFun: () => string[] = () => {
        return ["yes", "no"];

    }

    constructor(app: App, note: string, placeholder: string | null, getItemsFun: () => string[], callback: (e: string) => void) {
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
        this.callback(item);
        this.callback = null;
    }
    onClose(): void {
        setTimeout(() => {
            if (this.callback != null) {
                this.callback("");
            }
        }, 100);
    }
}