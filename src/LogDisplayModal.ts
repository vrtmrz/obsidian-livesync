import { App, Modal } from "obsidian";
import { logMessageStore } from "./lib/src/stores";
import { escapeStringToHTML } from "./lib/src/strbin";
import ObsidianLiveSyncPlugin from "./main";

export class LogDisplayModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    logEl: HTMLDivElement;
    unsubscribe: () => void;
    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();
        contentEl.createEl("h2", { text: "Sync Status" });
        const div = contentEl.createDiv("");
        div.addClass("op-scrollable");
        div.addClass("op-pre");
        this.logEl = div;
        this.unsubscribe = logMessageStore.observe((e) => {
            let msg = "";
            for (const v of e) {
                msg += escapeStringToHTML(v) + "<br>";
            }
            this.logEl.innerHTML = msg;
        })
        logMessageStore.invalidate();
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.unsubscribe) this.unsubscribe();
    }
}
