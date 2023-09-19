import { App, Modal } from "./deps";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT } from "diff-match-patch";
import { type diff_result } from "./lib/src/types";
import { escapeStringToHTML } from "./lib/src/strbin";

export class ConflictResolveModal extends Modal {
    // result: Array<[number, string]>;
    result: diff_result;
    filename: string;
    callback: (remove_rev: string) => Promise<void>;

    constructor(app: App, filename: string, diff: diff_result, callback: (remove_rev: string) => Promise<void>) {
        super(app);
        this.result = diff;
        this.callback = callback;
        this.filename = filename;
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText("Conflicting changes");
        contentEl.empty();
        contentEl.createEl("span", { text: this.filename });
        const div = contentEl.createDiv("");
        div.addClass("op-scrollable");
        let diff = "";
        for (const v of this.result.diff) {
            const x1 = v[0];
            const x2 = v[1];
            if (x1 == DIFF_DELETE) {
                diff += "<span class='deleted'>" + escapeStringToHTML(x2).replace(/\n/g, "<span class='ls-mark-cr'></span>\n") + "</span>";
            } else if (x1 == DIFF_EQUAL) {
                diff += "<span class='normal'>" + escapeStringToHTML(x2).replace(/\n/g, "<span class='ls-mark-cr'></span>\n") + "</span>";
            } else if (x1 == DIFF_INSERT) {
                diff += "<span class='added'>" + escapeStringToHTML(x2).replace(/\n/g, "<span class='ls-mark-cr'></span>\n") + "</span>";
            }
        }

        diff = diff.replace(/\n/g, "<br>");
        div.innerHTML = diff;
        const div2 = contentEl.createDiv("");
        const date1 = new Date(this.result.left.mtime).toLocaleString() + (this.result.left.deleted ? " (Deleted)" : "");
        const date2 = new Date(this.result.right.mtime).toLocaleString() + (this.result.right.deleted ? " (Deleted)" : "");
        div2.innerHTML = `
<span class='deleted'>A:${date1}</span><br /><span class='added'>B:${date2}</span><br> 
        `;
        contentEl.createEl("button", { text: "Keep A" }, (e) => {
            e.addEventListener("click", async () => {
                const callback = this.callback;
                this.callback = null;
                this.close();
                await callback(this.result.right.rev);
            });
        });
        contentEl.createEl("button", { text: "Keep B" }, (e) => {
            e.addEventListener("click", async () => {
                const callback = this.callback;
                this.callback = null;
                this.close();
                await callback(this.result.left.rev);
            });
        });
        contentEl.createEl("button", { text: "Concat both" }, (e) => {
            e.addEventListener("click", async () => {
                const callback = this.callback;
                this.callback = null;
                this.close();
                await callback("");
            });
        });
        contentEl.createEl("button", { text: "Not now" }, (e) => {
            e.addEventListener("click", () => {
                this.close();
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.callback != null) {
            this.callback(null);
        }
    }
}
