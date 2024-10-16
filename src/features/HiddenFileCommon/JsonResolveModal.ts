import { App, Modal } from "../../deps.ts";
import { type FilePath, type LoadedEntry } from "../../lib/src/common/types.ts";
import JsonResolvePane from "./JsonResolvePane.svelte";
import { waitForSignal } from "../../lib/src/common/utils.ts";

export class JsonResolveModal extends Modal {
    // result: Array<[number, string]>;
    filename: FilePath;
    callback?: (keepRev?: string, mergedStr?: string) => Promise<void>;
    docs: LoadedEntry[];
    component?: JsonResolvePane;
    nameA: string;
    nameB: string;
    defaultSelect: string;
    keepOrder: boolean;
    hideLocal: boolean;
    title: string = "Conflicted Setting";

    constructor(app: App, filename: FilePath,
        docs: LoadedEntry[], callback: (keepRev?: string, mergedStr?: string) => Promise<void>,
        nameA?: string, nameB?: string, defaultSelect?: string,
        keepOrder?: boolean, hideLocal?: boolean, title: string = "Conflicted Setting") {
        super(app);
        this.callback = callback;
        this.filename = filename;
        this.docs = docs;
        this.nameA = nameA || "";
        this.nameB = nameB || "";
        this.keepOrder = keepOrder || false;
        this.defaultSelect = defaultSelect || "";
        this.title = title;
        this.hideLocal = hideLocal ?? false;
        void waitForSignal(`cancel-internal-conflict:${filename}`).then(() => this.close());
    }
    async UICallback(keepRev?: string, mergedStr?: string) {
        this.close();
        await this.callback?.(keepRev, mergedStr);
        this.callback = undefined;
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        contentEl.empty();

        if (this.component == undefined) {
            this.component = new JsonResolvePane({
                target: contentEl,
                props: {
                    docs: this.docs,
                    filename: this.filename,
                    nameA: this.nameA,
                    nameB: this.nameB,
                    defaultSelect: this.defaultSelect,
                    keepOrder: this.keepOrder,
                    hideLocal: this.hideLocal,
                    callback: (keepRev: string | undefined, mergedStr: string | undefined) => this.UICallback(keepRev, mergedStr),
                },
            });
        }
        return;
    }


    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        // contentEl.empty();
        if (this.callback != undefined) {
            void this.callback(undefined);
        }
        if (this.component != undefined) {
            this.component.$destroy();
            this.component = undefined;
        }
    }
}
