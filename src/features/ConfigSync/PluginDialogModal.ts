import { mount, unmount } from "svelte";
import { type App, Modal } from "@/deps.ts";
import type { HiddenFileSyncInitialisationView } from "@/features/HiddenFileSync/hiddenFileSyncViews.ts";
import type { CustomisationSyncDialogView } from "./customisationSyncView.ts";
import PluginPane from "./PluginPane.svelte";
export class PluginDialogModal extends Modal {
    customisationSync: CustomisationSyncDialogView;
    hiddenFileSync: HiddenFileSyncInitialisationView;
    component: ReturnType<typeof mount> | undefined;
    isOpened() {
        return this.component != undefined;
    }

    constructor(
        app: App,
        customisationSync: CustomisationSyncDialogView,
        hiddenFileSync: HiddenFileSyncInitialisationView
    ) {
        super(app);
        this.customisationSync = customisationSync;
        this.hiddenFileSync = hiddenFileSync;
    }

    override onOpen() {
        const { contentEl } = this;
        this.contentEl.setCssStyles({
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
        });
        this.titleEl.setText("Customization Sync (Beta3)");
        if (!this.component) {
            this.component = mount(PluginPane, {
                target: contentEl,
                props: {
                    customisationSync: this.customisationSync,
                    hiddenFileSync: this.hiddenFileSync,
                },
            });
        }
    }

    override onClose() {
        if (this.component) {
            void unmount(this.component);
            this.component = undefined;
        }
    }
}
