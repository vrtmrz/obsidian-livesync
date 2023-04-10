import { App, Modal } from "./deps";
import { FilePath, LoadedEntry } from "./lib/src/types";
import JsonResolvePane from "./JsonResolvePane.svelte";

export class JsonResolveModal extends Modal {
    // result: Array<[number, string]>;
    filename: FilePath;
    callback: (keepRev: string, mergedStr?: string) => Promise<void>;
    docs: LoadedEntry[];
    component: JsonResolvePane;

    constructor(app: App, filename: FilePath, docs: LoadedEntry[], callback: (keepRev: string, mergedStr?: string) => Promise<void>) {
        super(app);
        this.callback = callback;
        this.filename = filename;
        this.docs = docs;
    }
    async UICallback(keepRev: string, mergedStr?: string) {
        this.close();
        await this.callback(keepRev, mergedStr);
        this.callback = null;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();

        if (this.component == null) {
            this.component = new JsonResolvePane({
                target: contentEl,
                props: {
                    docs: this.docs,
                    filename: this.filename,
                    callback: (keepRev, mergedStr) => this.UICallback(keepRev, mergedStr),
                },
            });
        }
        return;
    }


    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        // contentEl.empty();
        if (this.callback != null) {
            this.callback(null);
        }
        if (this.component != null) {
            this.component.$destroy();
            this.component = null;
        }
    }
}
