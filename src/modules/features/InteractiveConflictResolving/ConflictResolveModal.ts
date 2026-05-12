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
    currentDiffIndex = -1;
    diffView!: HTMLDivElement;
    diffNavIndicator!: HTMLSpanElement;

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

    navigateDiff(direction: "prev" | "next") {
        const diffElements = this.diffView.querySelectorAll(".added, .deleted");
        if (diffElements.length === 0) return;

        const prevFocused = this.diffView.querySelector(".diff-focused");
        if (prevFocused) {
            prevFocused.classList.remove("diff-focused");
        }

        if (direction === "next") {
            this.currentDiffIndex = (this.currentDiffIndex + 1) % diffElements.length;
        } else {
            this.currentDiffIndex =
                this.currentDiffIndex <= 0 ? diffElements.length - 1 : this.currentDiffIndex - 1;
        }

        const target = diffElements[this.currentDiffIndex];
        target.classList.add("diff-focused");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        this.diffNavIndicator.textContent = `${this.currentDiffIndex + 1}/${diffElements.length}`;
    }

    resetDiffNavigation() {
        this.currentDiffIndex = -1;
        const diffElements = this.diffView.querySelectorAll(".added, .deleted");
        this.diffNavIndicator.textContent = diffElements.length > 0 ? `0/${diffElements.length}` : "\u2014";
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
        const diffOptionsRow = contentEl.createDiv("");
        diffOptionsRow.addClass("diff-options-row");
        diffOptionsRow.createEl("span", { text: this.filename });

        const diffNavContainer = diffOptionsRow.createDiv("");
        diffNavContainer.addClass("diff-nav");
        diffNavContainer.createEl("button", { text: "\u25B2 Prev" }, (e) => {
            e.addClass("diff-nav-btn");
            e.addEventListener("click", () => this.navigateDiff("prev"));
        });
        diffNavContainer.createEl("button", { text: "\u25BC Next" }, (e) => {
            e.addClass("diff-nav-btn");
            e.addEventListener("click", () => this.navigateDiff("next"));
        });
        this.diffNavIndicator = diffNavContainer.createEl("span", { text: "\u2014" });
        this.diffNavIndicator.addClass("diff-nav-indicator");

        this.diffView = contentEl.createDiv("");
        this.diffView.addClass("op-scrollable");
        this.diffView.addClass("ls-dialog");
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
        div2.addClass("ls-dialog");
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
            this.diffView.innerText = "(Too large diff to display)";
        } else {
            this.diffView.innerHTML = diff;
        }
        this.resetDiffNavigation();
        this.navigateDiff("next");
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
