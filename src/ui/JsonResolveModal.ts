import { App, Modal } from "../deps.ts";
import { type FilePath, type LoadedEntry } from "../lib/src/common/types.ts";
import JsonResolvePane from "./JsonResolvePane.svelte";
import { waitForSignal } from "../lib/src/common/utils.ts";

export class JsonResolveModal extends Modal {
    // result: Array<[number, string]>;
    filename: FilePath;
    callback: (keepRev: string, mergedStr?: string) => Promise<void>;
    docs: LoadedEntry[];
    component: JsonResolvePane;
    nameA: string;
    nameB: string;
    defaultSelect: string;

    constructor(app: App, filename: FilePath, docs: LoadedEntry[], callback: (keepRev: string, mergedStr?: string) => Promise<void>, nameA?: string, nameB?: string, defaultSelect?: string) {
        super(app);
        this.callback = callback;
        this.filename = filename;
        this.docs = docs;
        this.nameA = nameA;
        this.nameB = nameB;
        this.defaultSelect = defaultSelect;
        waitForSignal(`cancel-internal-conflict:${filename}`).then(() => this.close());
    }
    async UICallback(keepRev: string, mergedStr?: string) {
        this.close();
        await this.callback(keepRev, mergedStr);
        this.callback = null;
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText("Conflicted Setting");
        contentEl.empty();

        if (this.component == null) {
            this.component = new JsonResolvePane({
                target: contentEl,
                props: {
                    docs: this.docs,
                    filename: this.filename,
                    nameA: this.nameA,
                    nameB: this.nameB,
                    defaultSelect: this.defaultSelect,
                    callback: (keepRev: string, mergedStr: string) => this.UICallback(keepRev, mergedStr),
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
