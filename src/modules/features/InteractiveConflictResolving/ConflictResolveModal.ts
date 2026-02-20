import { App, Modal } from "../../../deps.ts";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT } from "diff-match-patch";
import { CANCELLED, LEAVE_TO_SUBSEQUENT, type diff_result } from "../../../lib/src/common/types.ts";
import { escapeStringToHTML } from "../../../lib/src/string_and_binary/convert.ts";
import { delay } from "../../../lib/src/common/utils.ts";
import { eventHub } from "../../../common/events.ts";
import { globalSlipBoard } from "../../../lib/src/bureau/bureau.ts";

export type MergeDialogResult = typeof CANCELLED | typeof LEAVE_TO_SUBSEQUENT | string;

declare global {
    interface Slips extends LSSlips {
        "conflict-resolved": typeof CANCELLED | MergeDialogResult;
    }
}

export class ConflictResolveModal extends Modal {
    result: diff_result;
    filename: string;

    response: MergeDialogResult = CANCELLED;
    isClosed = false;
    consumed = false;

    title: string = "Conflicting changes";

    pluginPickMode: boolean = false;
    localName: string = "Base";
    remoteName: string = "Conflicted";
    offEvent?: ReturnType<typeof eventHub.onEvent>;

    constructor(app: App, filename: string, diff: diff_result, pluginPickMode?: boolean, remoteName?: string) {
        super(app);
        this.result = diff;
        this.filename = filename;
        this.pluginPickMode = pluginPickMode || false;
        if (this.pluginPickMode) {
            this.title = "Pick a version";
            this.remoteName = `${remoteName || "Remote"}`;
            this.localName = "Local";
        }
        // Send cancel signal for the previous merge dialogue
        // if not there, simply be ignored.
        // sendValue("close-resolve-conflict:" + this.filename, false);
    }

    override onOpen() {
        const { contentEl } = this;
        // Send cancel signal for the previous merge dialogue
        // if not there, simply be ignored.
        globalSlipBoard.submit("conflict-resolved", this.filename, CANCELLED);
        if (this.offEvent) {
            this.offEvent();
        }
        this.offEvent = eventHub.onEvent("conflict-cancelled", (path) => {
            if (path === this.filename) {
                this.sendResponse(CANCELLED);
            }
        });
        // sendValue("close-resolve-conflict:" + this.filename, false);
        this.titleEl.setText(this.title);
        contentEl.empty();
        contentEl.createEl("span", { text: this.filename });
        const div = contentEl.createDiv("");
        div.addClass("op-scrollable");
        let diff = "";
        for (const v of this.result.diff) {
            const x1 = v[0];
            const x2 = v[1];
            if (x1 == DIFF_DELETE) {
                diff +=
                    "<span class='deleted'>" +
                    escapeStringToHTML(x2).replace(/\n/g, "<span class='ls-mark-cr'></span>\n") +
                    "</span>";
            } else if (x1 == DIFF_EQUAL) {
                diff +=
                    "<span class='normal'>" +
                    escapeStringToHTML(x2).replace(/\n/g, "<span class='ls-mark-cr'></span>\n") +
                    "</span>";
            } else if (x1 == DIFF_INSERT) {
                diff +=
                    "<span class='added'>" +
                    escapeStringToHTML(x2).replace(/\n/g, "<span class='ls-mark-cr'></span>\n") +
                    "</span>";
            }
        }

        const div2 = contentEl.createDiv("");
        const date1 =
            new Date(this.result.left.mtime).toLocaleString() + (this.result.left.deleted ? " (Deleted)" : "");
        const date2 =
            new Date(this.result.right.mtime).toLocaleString() + (this.result.right.deleted ? " (Deleted)" : "");
        div2.innerHTML = `<span class='deleted'><span class='conflict-dev-name'>${this.localName}</span>: ${date1}</span><br>
<span class='added'><span class='conflict-dev-name'>${this.remoteName}</span>: ${date2}</span><br>`;
        contentEl.createEl("button", { text: `Use ${this.localName}` }, (e) =>
            e.addEventListener("click", () => this.sendResponse(this.result.right.rev))
        ).style.marginRight = "4px";
        contentEl.createEl("button", { text: `Use ${this.remoteName}` }, (e) =>
            e.addEventListener("click", () => this.sendResponse(this.result.left.rev))
        ).style.marginRight = "4px";
        if (!this.pluginPickMode) {
            contentEl.createEl("button", { text: "Concat both" }, (e) =>
                e.addEventListener("click", () => this.sendResponse(LEAVE_TO_SUBSEQUENT))
            ).style.marginRight = "4px";
        }
        contentEl.createEl("button", { text: !this.pluginPickMode ? "Not now" : "Cancel" }, (e) =>
            e.addEventListener("click", () => this.sendResponse(CANCELLED))
        ).style.marginRight = "4px";
        diff = diff.replace(/\n/g, "<br>");
        if (diff.length > 100 * 1024) {
            div.innerText = "(Too large diff to display)";
        } else {
            div.innerHTML = diff;
        }
    }

    sendResponse(result: MergeDialogResult) {
        this.response = result;
        this.close();
    }

    override onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.offEvent) {
            this.offEvent();
        }
        if (this.consumed) {
            return;
        }
        this.consumed = true;
        globalSlipBoard.submit("conflict-resolved", this.filename, this.response);
    }

    async waitForResult(): Promise<MergeDialogResult> {
        await delay(100);
        const r = await globalSlipBoard.awaitNext("conflict-resolved", this.filename);
        return r;
    }
}
