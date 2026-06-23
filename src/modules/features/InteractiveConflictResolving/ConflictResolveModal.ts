import { App, Modal } from "@/deps.ts";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT } from "diff-match-patch";
import { CANCELLED, LEAVE_TO_SUBSEQUENT, type diff_result } from "@lib/common/types.ts";
import { delay } from "@lib/common/utils.ts";
import { eventHub } from "@/common/events.ts";
import { globalSlipBoard } from "@lib/bureau/bureau.ts";

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

    appendDiffFragment(container: HTMLDivElement, text: string, cls: string) {
        const lines = text.split("\n");
        lines.forEach((line, index) => {
            const span = container.createSpan({ cls });
            span.setText(line);
            if (index < lines.length - 1) {
                container.createSpan({ cls: "ls-mark-cr" });
                container.createEl("br");
            }
        });
    }

    appendVersionInfo(container: HTMLDivElement, cls: string, name: string, date: string) {
        const line = container.createSpan({ cls });
        line.createSpan({ text: name, cls: "conflict-dev-name" });
        line.appendText(`: ${date}`);
        container.createEl("br");
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
            this.currentDiffIndex = this.currentDiffIndex <= 0 ? diffElements.length - 1 : this.currentDiffIndex - 1;
        }

        const target = diffElements[this.currentDiffIndex];
        target.classList.add("diff-focused");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        this.diffNavIndicator.setText(`${this.currentDiffIndex + 1}/${diffElements.length}`);
    }

    resetDiffNavigation() {
        this.currentDiffIndex = -1;
        const diffElements = this.diffView.querySelectorAll(".added, .deleted");
        this.diffNavIndicator.setText(diffElements.length > 0 ? `0/${diffElements.length}` : "\u2014");
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
        let diffLength = 0;
        for (const v of this.result.diff) {
            const x1 = v[0];
            const x2 = v[1];
            diffLength += x2.length;
            if (diffLength > 100 * 1024) {
                continue;
            }
            if (x1 == DIFF_DELETE) {
                this.appendDiffFragment(this.diffView, x2, "deleted");
            } else if (x1 == DIFF_EQUAL) {
                this.appendDiffFragment(this.diffView, x2, "normal");
            } else if (x1 == DIFF_INSERT) {
                this.appendDiffFragment(this.diffView, x2, "added");
            }
        }

        const div2 = contentEl.createDiv("");
        div2.addClass("ls-dialog");
        const date1 =
            new Date(this.result.left.mtime).toLocaleString() + (this.result.left.deleted ? " (Deleted)" : "");
        const date2 =
            new Date(this.result.right.mtime).toLocaleString() + (this.result.right.deleted ? " (Deleted)" : "");
        this.appendVersionInfo(div2, "deleted", this.localName, date1);
        this.appendVersionInfo(div2, "added", this.remoteName, date2);
        contentEl.createEl("button", { text: `Use ${this.localName}` }, (e) => {
            e.addClass("conflict-action-button");
            e.addEventListener("click", () => this.sendResponse(this.result.right.rev));
        });
        contentEl.createEl("button", { text: `Use ${this.remoteName}` }, (e) => {
            e.addClass("conflict-action-button");
            e.addEventListener("click", () => this.sendResponse(this.result.left.rev));
        });
        if (!this.pluginPickMode) {
            contentEl.createEl("button", { text: "Concat both" }, (e) => {
                e.addClass("conflict-action-button");
                e.addEventListener("click", () => this.sendResponse(LEAVE_TO_SUBSEQUENT));
            });
        }
        contentEl.createEl("button", { text: !this.pluginPickMode ? "Not now" : "Cancel" }, (e) => {
            e.addClass("conflict-action-button");
            e.addEventListener("click", () => this.sendResponse(CANCELLED));
        });
        if (diffLength > 100 * 1024) {
            this.diffView.empty();
            this.diffView.setText("(Too large diff to display)");
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
