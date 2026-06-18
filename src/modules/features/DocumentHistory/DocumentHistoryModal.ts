import { TFile, Modal, App, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "@/deps.ts";
import { getPathFromTFile, isValidPath } from "@/common/utils.ts";
import { decodeBinary, readString } from "@lib/string_and_binary/convert.ts";
import ObsidianLiveSyncPlugin from "@/main.ts";
import {
    type DocumentID,
    type FilePathWithPrefix,
    type LoadedEntry,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
} from "@lib/common/types.ts";
import { Logger } from "@lib/common/logger.ts";
import { isErrorOfMissingDoc } from "@lib/pouchdb/utils_couchdb.ts";
import { fireAndForget, getDocData, readContent } from "@lib/common/utils.ts";
import { isPlainText, stripPrefix } from "@lib/string_and_binary/path.ts";
import { scheduleOnceIfDuplicated } from "octagonal-wheels/concurrency/lock";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore.ts";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";

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
    diffOnly = false;
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
    diffOnlyLabel!: HTMLLabelElement;

    // Search state
    searchKeyword = "";
    searchResults: { rev: string; index: number; matchType: "Content" | "Diff" }[] = [];
    currentSearchIndex = -1;
    searchResultIndicator!: HTMLSpanElement;
    searchProgressIndicator!: HTMLSpanElement;
    searchTimeout: number | null = null;

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
        // eslint-disable-next-line obsidianmd/no-unsupported-api -- loadLocalStorage is supported in Obsidian 1.7.2+
        if (this.app.loadLocalStorage("ols-history-highlightdiff") == "1") {
            this.showDiff = true;
        }
        // eslint-disable-next-line obsidianmd/no-unsupported-api -- loadLocalStorage is supported in Obsidian 1.7.2+
        if (this.app.loadLocalStorage("ols-history-diffonly") == "1") {
            this.diffOnly = true;
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
        const index = this.revs_info.length - 1 - (Number(this.range.value) || 0);
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
        let hasOmitted = false;
        for (const [operation, text] of diff) {
            if (operation == DIFF_DELETE) {
                this.appendSearchHighlightedText(this.contentView.createSpan({ cls: "history-deleted" }), text);
                hasOmitted = false;
            } else if (operation == DIFF_EQUAL) {
                if (this.diffOnly) {
                    if (!hasOmitted) {
                        this.contentView.appendText("\n...\n");
                        hasOmitted = true;
                    }
                } else {
                    this.appendSearchHighlightedText(this.contentView.createSpan({ cls: "history-normal" }), text);
                }
            } else if (operation == DIFF_INSERT) {
                this.appendSearchHighlightedText(this.contentView.createSpan({ cls: "history-added" }), text);
                hasOmitted = false;
            }
        }
    }

    appendSearchHighlightedText(container: HTMLElement, text: string) {
        if (!this.searchKeyword) {
            container.appendText(text);
            return;
        }
        const escapedKeyword = this.searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escapedKeyword, "gi");
        let lastIndex = 0;
        for (const match of text.matchAll(regex)) {
            const index = match.index ?? 0;
            if (index > lastIndex) {
                container.appendText(text.slice(lastIndex, index));
            }
            container.createEl("mark", { text: match[0] });
            lastIndex = index + match[0].length;
        }
        if (lastIndex < text.length) {
            container.appendText(text.slice(lastIndex));
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
                const prevRevIdx = this.revs_info.length - 1 - ((Number(this.range.value) || 0) - 1);
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
                    this.appendSearchHighlightedText(this.contentView, w1data);
                }
            }
        }
        // Reset diff navigation after content changes
        this.resetDiffNavigation();
        if (this.showDiff) {
            this.navigateDiff("next");
        } else if (this.searchKeyword) {
            const firstMark = this.contentView.querySelector("mark");
            if (firstMark) {
                firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
            }
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

        this.diffNavIndicator.setText(`${this.currentDiffIndex + 1}/${diffElements.length}`);
    }

    /**
     * Reset the diff navigation index and update the indicator.
     */
    resetDiffNavigation() {
        this.currentDiffIndex = -1;
        if (this.diffNavIndicator) {
            if (this.showDiff) {
                const diffElements = this.contentView.querySelectorAll(".history-added, .history-deleted");
                this.diffNavIndicator.setText(diffElements.length > 0 ? `0/${diffElements.length}` : "\u2014");
            } else {
                this.diffNavIndicator.setText("\u2014");
            }
        }
        this.updateDiffNavVisibility();
    }

    /**
     * Show or hide the diff navigation buttons based on the showDiff state.
     */
    updateDiffNavVisibility() {
        if (this.diffNavContainer) {
            this.diffNavContainer.setCssStyles({ display: this.showDiff ? "flex" : "none" });
        }
        if (this.diffOnlyLabel) {
            this.diffOnlyLabel.setCssStyles({ display: this.showDiff ? "inline-block" : "none" });
        }
    }

    /**
     * Search through the last 100 revisions for the given keyword.
     */
    async performSearch(keyword: string) {
        this.searchKeyword = keyword;
        this.searchResults = [];
        this.currentSearchIndex = -1;

        if (!keyword) {
            this.searchResultIndicator.setText("");
            this.searchProgressIndicator.setText("");
            return;
        }

        const db = this.core.localDatabase;
        const limit = 100;
        const totalRevs = this.revs_info.length;
        const end = Math.min(totalRevs, limit);

        this.searchProgressIndicator.setText("Searching...");

        const dmp = new diff_match_patch();

        // 0 is the newest, higher index is older.
        for (let i = 0; i < end; i++) {
            const revInfo = this.revs_info[i];
            const rev = revInfo.rev;

            this.searchProgressIndicator.setText(`Searching ${i + 1}/${end}...`);

            const doc = await db.getDBEntry(this.file, { rev: rev }, false, false, true);
            if (doc === false) continue;

            const content = readDocument(doc);
            if (typeof content !== "string") continue;

            const keywordLower = keyword.toLocaleLowerCase();

            // Search in content
            if (content.toLocaleLowerCase().includes(keywordLower)) {
                this.searchResults.push({ rev, index: i, matchType: "Content" });
                this.updateSearchUI();
                continue;
            }

            // Search in diff (from older version to this version)
            // Older version is at i + 1
            if (i < totalRevs - 1) {
                const olderRev = this.revs_info[i + 1].rev;
                const olderDoc = await db.getDBEntry(this.file, { rev: olderRev }, false, false, true);
                if (olderDoc !== false) {
                    const olderContent = readDocument(olderDoc);
                    if (typeof olderContent === "string") {
                        const diffs = dmp.diff_main(olderContent, content);
                        let foundInDiff = false;
                        for (const d of diffs) {
                            if (
                                (d[0] === DIFF_INSERT || d[0] === DIFF_DELETE) &&
                                d[1].toLocaleLowerCase().includes(keywordLower)
                            ) {
                                foundInDiff = true;
                                break;
                            }
                        }
                        if (foundInDiff) {
                            this.searchResults.push({ rev, index: i, matchType: "Diff" });
                            this.updateSearchUI();
                        }
                    }
                }
            }
        }

        this.searchProgressIndicator.setText("Done");
        this.updateSearchUI();
    }

    updateSearchUI() {
        if (this.searchResults.length === 0) {
            this.searchResultIndicator.setText(this.searchKeyword ? "No matches found" : "");
        } else {
            const current = this.currentSearchIndex >= 0 ? this.currentSearchIndex + 1 : 0;
            this.searchResultIndicator.setText(`${current}/${this.searchResults.length} matches`);
        }
    }

    navigateSearch(direction: "prev" | "next") {
        if (this.searchResults.length === 0) return;

        if (direction === "next") {
            this.currentSearchIndex = (this.currentSearchIndex + 1) % this.searchResults.length;
        } else {
            this.currentSearchIndex =
                this.currentSearchIndex <= 0 ? this.searchResults.length - 1 : this.currentSearchIndex - 1;
        }

        const match = this.searchResults[this.currentSearchIndex];
        this.range.value = `${this.revs_info.length - 1 - match.index}`;
        void scheduleOnceIfDuplicated("loadRevs", () => this.loadRevs());
        this.updateSearchUI();

        // If it's a diff match, make sure Highlight diff is on
        if (match.matchType === "Diff" && !this.showDiff) {
            // We could auto-enable it, but maybe just notify the user?
            // For now, let's just let the user toggle it if they want to see the diff.
        }
    }

    override onOpen() {
        const { contentEl } = this;
        this.titleEl.setText("Document History");
        contentEl.empty();
        this.fileInfo = contentEl.createDiv("");
        this.fileInfo.addClass("op-info");

        // Search Row
        const searchRow = contentEl.createDiv("");
        searchRow.addClass("op-info");
        searchRow.addClass("search-row");
        searchRow.addClass("history-search-row");

        const searchInput = searchRow.createEl("input", {
            type: "text",
            placeholder: "Search in history (last 100)...",
        });
        searchInput.addClass("history-search-input");
        searchInput.addEventListener("input", () => {
            if (this.searchTimeout) {
                compatGlobal.clearTimeout(this.searchTimeout);
            }
            this.searchTimeout = compatGlobal.setTimeout(() => {
                void this.performSearch(searchInput.value);
            }, 500);
        });

        searchRow.createEl("button", { text: "\u25B2" }, (e) => {
            e.title = "Previous match";
            e.addEventListener("click", () => this.navigateSearch("prev"));
        });
        searchRow.createEl("button", { text: "\u25BC" }, (e) => {
            e.title = "Next match";
            e.addEventListener("click", () => this.navigateSearch("next"));
        });

        this.searchResultIndicator = searchRow.createEl("span", { text: "" });
        this.searchResultIndicator.addClass("history-search-result-indicator");

        this.searchProgressIndicator = searchRow.createEl("span", { text: "" });
        this.searchProgressIndicator.addClass("history-search-progress-indicator");

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
        diffOptionsRow.addClass("history-diff-options-row");

        const highlightDiffContainer = diffOptionsRow.createDiv("");
        highlightDiffContainer.addClass("history-highlight-diff-container");

        highlightDiffContainer.createEl("label", {}, (label) => {
            label.addClass("history-highlight-diff-label");
            label.createEl("input", { type: "checkbox" }, (checkbox) => {
                if (this.showDiff) {
                    checkbox.checked = true;
                }
                checkbox.addEventListener("input", (evt: Event) => {
                    this.showDiff = checkbox.checked;
                    // eslint-disable-next-line obsidianmd/no-unsupported-api -- saveLocalStorage is supported in Obsidian 1.7.2+
                    this.app.saveLocalStorage("ols-history-highlightdiff", this.showDiff == true ? "1" : null);
                    this.updateDiffNavVisibility();
                    void scheduleOnceIfDuplicated("loadRevs", () => this.loadRevs());
                });
            });
            label.appendText("Highlight diff");
        });

        const diffOnlyLabel = diffOptionsRow.createEl("label", {});
        diffOnlyLabel.createEl("input", { type: "checkbox" }, (checkbox) => {
            if (this.diffOnly) {
                checkbox.checked = true;
            }
            checkbox.addEventListener("input", (evt: Event) => {
                this.diffOnly = checkbox.checked;
                // eslint-disable-next-line obsidianmd/no-unsupported-api -- saveLocalStorage is supported in Obsidian 1.7.2+
                this.app.saveLocalStorage("ols-history-diffonly", this.diffOnly == true ? "1" : null);
                void scheduleOnceIfDuplicated("loadRevs", () => this.loadRevs());
            });
        });
        diffOnlyLabel.appendText("Diff only");
        diffOnlyLabel.addClass("diff-only-label");
        diffOnlyLabel.setCssStyles({ display: this.showDiff ? "inline-block" : "none" });
        this.diffOnlyLabel = diffOnlyLabel;

        // Diff navigation buttons
        this.diffNavContainer = diffOptionsRow.createDiv("");
        this.diffNavContainer.addClass("diff-nav");
        this.diffNavContainer.setCssStyles({ display: this.showDiff ? "flex" : "none" });

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
                    await compatGlobal.navigator.clipboard.writeText(this.currentText);
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
