import { App, Modal } from "../../deps.ts";
import ObsidianLiveSyncPlugin from "../../main.ts";
import PluginPane from "./PluginPane.svelte";
export class PluginDialogModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    component: PluginPane | undefined;
    isOpened() {
        return this.component != undefined;
    }

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        this.contentEl.style.overflow = "auto";
        this.contentEl.style.display = "flex";
        this.contentEl.style.flexDirection = "column";
        this.titleEl.setText("Customization Sync (Beta3)")
        if (!this.component) {
            this.component = new PluginPane({
                target: contentEl, props: { plugin: this.plugin },
            });
        }
    }

    onClose() {
        if (this.component) {
            this.component.$destroy();
            this.component = undefined;
        }
    }
}