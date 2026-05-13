import { TFile, Modal, App, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "../../../deps.ts";
import { getPathFromTFile, isValidPath } from "../../../common/utils.ts";
import { decodeBinary, readString } from "../../../lib/src/string_and_binary/convert.ts";
import ObsidianLiveSyncPlugin from "../../../main.ts";
import {
    type DocumentID,
    type FilePathWithPrefix,
    type LoadedEntry,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
} from "../../../lib/src/common/types.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { isErrorOfMissingDoc } from "../../../lib/src/pouchdb/utils_couchdb.ts";
import { fireAndForget, getDocData, readContent } from "../../../lib/src/common/utils.ts";
import { isPlainText, stripPrefix } from "../../../lib/src/string_and_binary/path.ts";
import { scheduleOnceIfDuplicated } from "octagonal-wheels/concurrency/lock";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";

function isImage(path: string) {
    const ext = path.split(".").splice(-1)[0].toLowerCase();
    return ["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext);
}
function isComparableText(path: string) {
    const ext = path.split(".").splice(-1)[0].toLowerCase();
    return isPlainText(path) || ["md", "mdx", "txt", "json"].includes(ext);
}
function isComparableTextDecode(path: string) {
    const ext = path.split(".").splice(-1)[0].toLowerCase();
    return ["json"].includes(ext);
}
function readDocument(w: LoadedEntry) {
    if (w.data.length == 0) return "";
    if (isImage(w.path)) {
        return new Uint8Array(decodeBinary(w.data));
    }
    if (w.type == "plain" || w.datatype == "plain") return getDocData(w.data);
    if (isComparableTextDecode(w.path)) return readString(new Uint8Array(decodeBinary(w.data)));
    if (isComparableText(w.path)) return getDocData(w.data);
    try {
        return readString(new Uint8Array(decodeBinary(w.data)));
    } catch (ex) {
        Logger(ex, LOG_LEVEL_VERBOSE);
        // NO OP.
    }
    return getDocData(w.data);
}
export class DocumentHistoryModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncBaseCore;
    get services() {
        return this.core.services;
    }
    range!: HTMLInputElement;
    contentView!: HTMLDivElement;
    info!: HTMLDivElement;
    fileInfo!: HTMLDivElement;
    showDiff = false;
    id?: DocumentID;

    file: FilePathWithPrefix;

    revs_info: PouchDB.Core.RevisionInfo[] = [];
    currentDoc?: LoadedEntry;
    currentText = "";
    currentDeleted = false;
    initialRev?: string;

    // Diff navigation state
    currentDiffIndex = -1;
    diffNavContainer!: HTMLDivElement;
    diffNavIndicator!: HTMLSpanElement;

    constructor(
        app: App,
        core: LiveSyncBaseCore,
        plugin: ObsidianLiveSyncPlugin,
        file: TFile | FilePathWithPrefix,
        id?: DocumentID,
        revision?: string
    ) {
        super(app);
        this.plugin = plugin;
        this.core = core;
        this.file = file instanceof TFile ? getPathFromTFile(file) : file;
        this.id = id;
        this.initialRev = revision;
        if (!file && id) {
            this.file = this.services.path.id2path(id);
        }
        if (localStorage.getItem("ols-history-highlightdiff") == "1") {
            this.showDiff = true;
        }
    }

    async loadFile(initialRev?: string) {
        if (!this.id) {
            this.id = await this.services.path.path2id(this.file);
        }
        const db = this.core.localDatabase;
        try {
            const w = await db.getRaw(this.id, { revs_info: true });
            this.revs_info = w._revs_info?.filter((e) => e?.status == "available") ?? [];
            this.range.max = `${Math.max(this.revs_info.length - 1, 0)}`;
            this.range.value = this.range.max;
            this.fileInfo.setText(`${this.file} / ${this.revs_info.length} revisions`);
            await this.loadRevs(initialRev);
        } catch (ex) {
            if (isErrorOfMissingDoc(ex)) {
                this.range.max = "0";
                this.range.value = "";
                this.range.disabled = true;
                this.contentView.setText(`We don't have any history for this note.`);
            } else {
                this.contentView.setText(`Error while loading file.`);
                Logger(ex, LOG_LEVEL_VERBOSE);
            }
        }
    }
    async loadRevs(initialRev?: string) {
        if (this.revs_info.length == 0) return;
        if (initialRev) {
            const rIndex = this.revs_info.findIndex((e) => e.rev == initialRev);
            if (rIndex >= 0) {
                this.range.value = `${this.revs_info.length - 1 - rIndex}`;
            }
        }
        const index = this.revs_info.length - 1 - (this.range.value as any) / 1;
        const rev = this.revs_info[index];
        await this.showExactRev(rev.rev);
    }
    BlobURLs = new Map<string, string>();

    revokeURL(key: string) {
        const v = this.BlobURLs.get(key);
        if (v) {
            URL.revokeObjectURL(v);
        }
        this.BlobURLs.delete(key);
    }
    generateBlobURL(key: string, data: Uint8Array<ArrayBuffer>) {
        this.revokeURL(key);
        const v = URL.createObjectURL(new Blob([data], { endings: "transparent", type: "application/octet-stream" }));
        this.BlobURLs.set(key, v);
        return v;
    }

    prepareContentView(usePreformatted = true) {
        this.contentView.empty();
        this.contentView.toggleClass("op-pre", usePreformatted);
    }

    appendTextDiff(diff: [number, string][]) {
        for (const [operation, text] of diff) {
            if (operation == DIFF_DELETE) {
                this.contentView.createSpan({ text, cls: "history-deleted" });
            } else if (operation == DIFF_EQUAL) {
                this.contentView.createSpan({ text, cls: "history-normal" });
            } else if (operation == DIFF_INSERT) {
                this.contentView.createSpan({ text, cls: "history-added" });
            }
        }
    }

    appendImageDiff(baseSrc: string, overlaySrc?: string) {
        const wrap = this.contentView.createDiv({ cls: "ls-imgdiff-wrap" });
        const overlay = wrap.createDiv({ cls: "overlay" });
        overlay.createEl("img", { cls: "img-base" }, (img) => {
            img.src = baseSrc;
        });
        if (overlaySrc) {
            overlay.createEl("img", { cls: "img-overlay" }, (img) => {
                img.src = overlaySrc;
            });
        }
    }

    appendDeletedNotice(usePreformatted = true) {
        const notice = "(At this revision, the file has been deleted)";
        if (usePreformatted) {
            this.contentView.appendText(`${notice}\n`);
        } else {
            this.contentView.createDiv({ text: notice });
        }
    }

    async showExactRev(rev: string) {
        const db = this.core.localDatabase;
        const w = await db.getDBEntry(this.file, { rev: rev }, false, false, true);
        this.currentText = "";
        this.currentDeleted = false;
        this.prepareContentView();
        if (w === false) {
            this.currentDeleted = true;
            this.info.empty();
            this.contentView.appendText("Could not read this revision");
            this.contentView.createEl("br");
            this.contentView.appendText(`(${rev})`);
        } else {
            this.currentDoc = w;
            this.info.setText(`Modified:${new Date(w.mtime).toLocaleString()}`);
            const w1data = readDocument(w);
            this.currentDeleted = !!w.deleted;
            if (typeof w1data == "string") {
                this.currentText = w1data;
            }
            let rendered = false;
            if (this.showDiff) {
                const prevRevIdx = this.revs_info.length - 1 - ((this.range.value as any) / 1 - 1);
                if (prevRevIdx >= 0 && prevRevIdx < this.revs_info.length) {
                    const oldRev = this.revs_info[prevRevIdx].rev;
                    const w2 = await db.getDBEntry(this.file, { rev: oldRev }, false, false, true);
                    if (w2 != false) {
                        if (typeof w1data == "string") {
                            const w2data = readDocument(w2);
                            if (typeof w2data == "string") {
                                const dmp = new diff_match_patch();
                                const diff = dmp.diff_main(w2data, w1data);
                                dmp.diff_cleanupSemantic(diff);
                                if (this.currentDeleted) {
                                    this.appendDeletedNotice();
                                }
                                this.appendTextDiff(diff);
                                rendered = true;
                            }
                        } else if (isImage(this.file)) {
                            const src = this.generateBlobURL("base", w1data);
                            const overlay = this.generateBlobURL(
                                "overlay",
                                readDocument(w2) as Uint8Array<ArrayBuffer>
                            );
                            this.prepareContentView(false);
                            if (this.currentDeleted) {
                                this.appendDeletedNotice(false);
                            }
                            this.appendImageDiff(src, overlay);
                            rendered = true;
                        }
                    }
                }
            }
            if (!rendered) {
                if (typeof w1data != "string") {
                    if (isImage(this.file)) {
                        const src = this.generateBlobURL("base", w1data);
                        this.prepareContentView(false);
                        if (this.currentDeleted) {
                            this.appendDeletedNotice(false);
                        }
                        this.appendImageDiff(src);
                    } else {
                        if (this.currentDeleted) {
                            this.appendDeletedNotice();
                        }
                        this.contentView.appendText("Binary file");
                    }
                } else {
                    if (this.currentDeleted) {
                        this.appendDeletedNotice();
                    }
                    this.contentView.appendText(w1data);
                }
            }
        }
        // Reset diff navigation after content changes
        this.resetDiffNavigation();
        if (this.showDiff) {
            this.navigateDiff("next");
        }
    }

    /**
     * Navigate to the previous or next diff block in the content view.
     * Only effective when diff highlighting is enabled.
     */
    navigateDiff(direction: "prev" | "next") {
        const diffElements = this.contentView.querySelectorAll(".history-added, .history-deleted");
        if (diffElements.length === 0) return;

        // Remove previous focus highlight
        const prevFocused = this.contentView.querySelector(".diff-focused");
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

        this.diffNavIndicator.textContent = `${this.currentDiffIndex + 1}/${diffElements.length}`;
    }

    /**
     * Reset the diff navigation index and update the indicator.
     */
    resetDiffNavigation() {
        this.currentDiffIndex = -1;
        if (this.diffNavIndicator) {
            if (this.showDiff) {
                const diffElements = this.contentView.querySelectorAll(".history-added, .history-deleted");
                this.diffNavIndicator.textContent = diffElements.length > 0 ? `0/${diffElements.length}` : "\u2014";
            } else {
                this.diffNavIndicator.textContent = "\u2014";
            }
        }
        this.updateDiffNavVisibility();
    }

    /**
     * Show or hide the diff navigation buttons based on the showDiff state.
     */
    updateDiffNavVisibility() {
        if (this.diffNavContainer) {
            this.diffNavContainer.style.display = this.showDiff ? "flex" : "none";
        }
    }

    override onOpen() {
        const { contentEl } = this;
        this.titleEl.setText("Document History");
        contentEl.empty();
        this.fileInfo = contentEl.createDiv("");
        this.fileInfo.addClass("op-info");
        const divView = contentEl.createDiv("");
        divView.addClass("op-flex");

        divView.createEl("input", { type: "range" }, (e) => {
            this.range = e;
            e.addEventListener("change", (e) => {
                void scheduleOnceIfDuplicated("loadRevs", () => this.loadRevs());
            });
            e.addEventListener("input", (e) => {
                void scheduleOnceIfDuplicated("loadRevs", () => this.loadRevs());
            });
        });
        const diffOptionsRow = contentEl.createDiv("");
        diffOptionsRow.addClass("op-info");
        diffOptionsRow.addClass("diff-options-row");

        diffOptionsRow.createEl("label", {}, (label) => {
            label.appendChild(
                createEl("input", { type: "checkbox" }, (checkbox) => {
                    if (this.showDiff) {
                        checkbox.checked = true;
                    }
                    checkbox.addEventListener("input", (evt: any) => {
                        this.showDiff = checkbox.checked;
                        localStorage.setItem("ols-history-highlightdiff", this.showDiff == true ? "1" : "");
                        this.updateDiffNavVisibility();
                        void scheduleOnceIfDuplicated("loadRevs", () => this.loadRevs());
                    });
                })
            );
            label.appendText("Highlight diff");
        });

        // Diff navigation buttons
        this.diffNavContainer = diffOptionsRow.createDiv("");
        this.diffNavContainer.addClass("diff-nav");
        this.diffNavContainer.style.display = this.showDiff ? "flex" : "none";

        this.diffNavContainer.createEl("button", { text: "\u25B2 Prev" }, (e) => {
            e.addClass("diff-nav-btn");
            e.addEventListener("click", () => {
                this.navigateDiff("prev");
            });
        });
        this.diffNavContainer.createEl("button", { text: "\u25BC Next" }, (e) => {
            e.addClass("diff-nav-btn");
            e.addEventListener("click", () => {
                this.navigateDiff("next");
            });
        });
        this.diffNavIndicator = this.diffNavContainer.createEl("span", { text: "\u2014" });
        this.diffNavIndicator.addClass("diff-nav-indicator");

        this.info = contentEl.createDiv("");
        this.info.addClass("op-info");
        fireAndForget(async () => await this.loadFile(this.initialRev));
        const div = contentEl.createDiv({ text: "Loading old revisions..." });
        this.contentView = div;
        div.addClass("op-scrollable");
        div.addClass("op-pre");
        const buttons = contentEl.createDiv("");
        buttons.createEl("button", { text: "Copy to clipboard" }, (e) => {
            e.addClass("mod-cta");
            e.addEventListener("click", () => {
                fireAndForget(async () => {
                    await navigator.clipboard.writeText(this.currentText);
                    Logger(`Old content copied to clipboard`, LOG_LEVEL_NOTICE);
                });
            });
        });
        const focusFile = async (path: string) => {
            const targetFile = this.plugin.app.vault.getFileByPath(path);
            if (targetFile) {
                const leaf = this.plugin.app.workspace.getLeaf(false);
                await leaf.openFile(targetFile);
            } else {
                Logger("Unable to display the file in the editor", LOG_LEVEL_NOTICE);
            }
        };
        buttons.createEl("button", { text: "Back to this revision" }, (e) => {
            e.addClass("mod-cta");
            e.addEventListener("click", () => {
                fireAndForget(async () => {
                    // const pathToWrite = this.plugin.id2path(this.id, true);
                    const pathToWrite = stripPrefix(this.file);
                    if (!isValidPath(pathToWrite)) {
                        Logger("Path is not valid to write content.", LOG_LEVEL_INFO);
                        return;
                    }
                    if (!this.currentDoc) {
                        Logger("No active file loaded.", LOG_LEVEL_INFO);
                        return;
                    }
                    const d = readContent(this.currentDoc);
                    await this.core.storageAccess.writeHiddenFileAuto(pathToWrite, d);
                    await focusFile(pathToWrite);
                    this.close();
                });
            });
        });
    }
    override onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.BlobURLs.forEach((value) => {
            console.log(value);
            if (value) URL.revokeObjectURL(value);
        });
    }
}
