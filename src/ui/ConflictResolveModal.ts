import { App, Modal } from "../deps.ts";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT } from "diff-match-patch";
import { CANCELLED, LEAVE_TO_SUBSEQUENT, RESULT_TIMED_OUT, type diff_result } from "../lib/src/common/types.ts";
import { escapeStringToHTML } from "../lib/src/string_and_binary/convert.ts";
import { delay, sendValue, waitForValue } from "../lib/src/common/utils.ts";

export type MergeDialogResult = typeof LEAVE_TO_SUBSEQUENT | typeof CANCELLED | string;
export class ConflictResolveModal extends Modal {
    result: diff_result;
    filename: string;

    response: MergeDialogResult = CANCELLED;
    isClosed = false;
    consumed = false;

    constructor(app: App, filename: string, diff: diff_result) {
        super(app);
        this.result = diff;
        this.filename = filename;
        // Send cancel signal for the previous merge dialogue
        // if not there, simply be ignored.
        // sendValue("close-resolve-conflict:" + this.filename, false);
        sendValue("cancel-resolve-conflict:" + this.filename, true);
    }

    onOpen() {
        const { contentEl } = this;
        // Send cancel signal for the previous merge dialogue
        // if not there, simply be ignored.
        sendValue("cancel-resolve-conflict:" + this.filename, true);
        setTimeout(async () => {
            const forceClose = await waitForValue("cancel-resolve-conflict:" + this.filename);
            // debugger;
            if (forceClose) {
                this.sendResponse(CANCELLED);
            }
        }, 10)
        // sendValue("close-resolve-conflict:" + this.filename, false);
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
        contentEl.createEl("button", { text: "Keep A" }, (e) => e.addEventListener("click", () => this.sendResponse(this.result.right.rev)));
        contentEl.createEl("button", { text: "Keep B" }, (e) => e.addEventListener("click", () => this.sendResponse(this.result.left.rev)));
        contentEl.createEl("button", { text: "Concat both" }, (e) => e.addEventListener("click", () => this.sendResponse(LEAVE_TO_SUBSEQUENT)));
        contentEl.createEl("button", { text: "Not now" }, (e) => e.addEventListener("click", () => this.sendResponse(CANCELLED)));
    }

    sendResponse(result: MergeDialogResult) {
        this.response = result;
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.consumed) {
            return;
        }
        this.consumed = true;
        sendValue("close-resolve-conflict:" + this.filename, this.response);
        sendValue("cancel-resolve-conflict:" + this.filename, false);
    }

    async waitForResult(): Promise<MergeDialogResult> {
        await delay(100);
        const r = await waitForValue<MergeDialogResult>("close-resolve-conflict:" + this.filename);
        if (r === RESULT_TIMED_OUT) return CANCELLED;
        return r;
    }
}