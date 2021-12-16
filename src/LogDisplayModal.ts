import { App, Modal } from "obsidian";
import { escapeStringToHTML } from "./utils";
import ObsidianLiveSyncPlugin from "./main";

export class LogDisplayModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    logEl: HTMLDivElement;
    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app);
        this.plugin = plugin;
    }
    updateLog() {
        let msg = "";
        for (const v of this.plugin.logMessage) {
            msg += escapeStringToHTML(v) + "<br>";
        }
        this.logEl.innerHTML = msg;
    }
    onOpen() {
        const { contentEl } = this;

        contentEl.empty();
        contentEl.createEl("h2", { text: "Sync Status" });
        const div = contentEl.createDiv("");
        div.addClass("op-scrollable");
        div.addClass("op-pre");
        this.logEl = div;
        this.updateLog = this.updateLog.bind(this);
        this.plugin.addLogHook = this.updateLog;
        this.updateLog();
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.plugin.addLogHook = null;
    }
}
