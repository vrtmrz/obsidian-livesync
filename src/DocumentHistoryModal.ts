import { TFile, Modal, App, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "./deps";
import { getPathFromTFile, isValidPath } from "./utils";
import { decodeBinary, escapeStringToHTML, readString } from "./lib/src/strbin";
import ObsidianLiveSyncPlugin from "./main";
import { type DocumentID, type FilePathWithPrefix, type LoadedEntry, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "./lib/src/types";
import { Logger } from "./lib/src/logger";
import { isErrorOfMissingDoc } from "./lib/src/utils_couchdb";
import { getDocData } from "./lib/src/utils";
import { stripPrefix } from "./lib/src/path";

export class DocumentHistoryModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
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

    constructor(app: App, plugin: ObsidianLiveSyncPlugin, file: TFile | FilePathWithPrefix, id?: DocumentID, revision?: string) {
        super(app);
        this.plugin = plugin;
        this.file = (file instanceof TFile) ? getPathFromTFile(file) : file;
        this.id = id;
        this.initialRev = revision;
        if (!file && id) {
            this.file = this.plugin.id2path(id);
        }
        if (localStorage.getItem("ols-history-highlightdiff") == "1") {
            this.showDiff = true;
        }
    }

    async loadFile(initialRev: string) {
        if (!this.id) {
            this.id = await this.plugin.path2id(this.file);
        }
        const db = this.plugin.localDatabase;
        try {
            const w = await db.localDatabase.get(this.id, { revs_info: true });
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
                this.showDiff
                this.contentView.setText(`History of this file was not recorded.`);
            } else {
                this.contentView.setText(`Error occurred.`);
                Logger(ex, LOG_LEVEL_VERBOSE);
            }
        }
    }
    async loadRevs(initialRev?: string) {
        if (this.revs_info.length == 0) return;
        if (initialRev) {
            const rIndex = this.revs_info.findIndex(e => e.rev == initialRev);
            if (rIndex >= 0) {
                this.range.value = `${this.revs_info.length - 1 - rIndex}`;
            }
        }
        const index = this.revs_info.length - 1 - (this.range.value as any) / 1;
        const rev = this.revs_info[index];
        await this.showExactRev(rev.rev);
    }
    async showExactRev(rev: string) {
        const db = this.plugin.localDatabase;
        const w = await db.getDBEntry(this.file, { rev: rev }, false, false, true);
        this.currentText = "";
        this.currentDeleted = false;
        if (w === false) {
            this.currentDeleted = true;
            this.info.innerHTML = "";
            this.contentView.innerHTML = `Could not read this revision<br>(${rev})`;
        } else {
            this.currentDoc = w;
            this.info.innerHTML = `Modified:${new Date(w.mtime).toLocaleString()}`;
            let result = "";
            const w1data = w.datatype == "plain" ? getDocData(w.data) : readString(new Uint8Array(decodeBinary(w.data)));
            this.currentDeleted = !!w.deleted;
            this.currentText = w1data;
            if (this.showDiff) {
                const prevRevIdx = this.revs_info.length - 1 - ((this.range.value as any) / 1 - 1);
                if (prevRevIdx >= 0 && prevRevIdx < this.revs_info.length) {
                    const oldRev = this.revs_info[prevRevIdx].rev;
                    const w2 = await db.getDBEntry(this.file, { rev: oldRev }, false, false, true);
                    if (w2 != false) {
                        const dmp = new diff_match_patch();
                        const w2data = w2.datatype == "plain" ? getDocData(w2.data) : readString(new Uint8Array(decodeBinary(w2.data)));
                        const diff = dmp.diff_main(w2data, w1data);
                        dmp.diff_cleanupSemantic(diff);
                        for (const v of diff) {
                            const x1 = v[0];
                            const x2 = v[1];
                            if (x1 == DIFF_DELETE) {
                                result += "<span class='history-deleted'>" + escapeStringToHTML(x2) + "</span>";
                            } else if (x1 == DIFF_EQUAL) {
                                result += "<span class='history-normal'>" + escapeStringToHTML(x2) + "</span>";
                            } else if (x1 == DIFF_INSERT) {
                                result += "<span class='history-added'>" + escapeStringToHTML(x2) + "</span>";
                            }
                        }

                        result = result.replace(/\n/g, "<br>");
                    } else {
                        result = escapeStringToHTML(w1data);
                    }
                } else {
                    result = escapeStringToHTML(w1data);
                }
            } else {
                result = escapeStringToHTML(w1data);
            }
            this.contentView.innerHTML = (this.currentDeleted ? "(At this revision, the file has been deleted)\n" : "") + result;
        }
    }

    onOpen() {
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
                this.loadRevs();
            });
            e.addEventListener("input", (e) => {
                this.loadRevs();
            });
        });
        contentEl
            .createDiv("", (e) => {
                e.createEl("label", {}, (label) => {
                    label.appendChild(
                        createEl("input", { type: "checkbox" }, (checkbox) => {
                            if (this.showDiff) {
                                checkbox.checked = true;
                            }
                            checkbox.addEventListener("input", (evt: any) => {
                                this.showDiff = checkbox.checked;
                                localStorage.setItem("ols-history-highlightdiff", this.showDiff == true ? "1" : "");
                                this.loadRevs();
                            });
                        })
                    );
                    label.appendText("Highlight diff");
                });
            })
            .addClass("op-info");
        this.info = contentEl.createDiv("");
        this.info.addClass("op-info");
        this.loadFile(this.initialRev);
        const div = contentEl.createDiv({ text: "Loading old revisions..." });
        this.contentView = div;
        div.addClass("op-scrollable");
        div.addClass("op-pre");
        const buttons = contentEl.createDiv("");
        buttons.createEl("button", { text: "Copy to clipboard" }, (e) => {
            e.addClass("mod-cta");
            e.addEventListener("click", async () => {
                await navigator.clipboard.writeText(this.currentText);
                Logger(`Old content copied to clipboard`, LOG_LEVEL_NOTICE);
            });
        });
        async function focusFile(path: string) {
            const targetFile = app.vault
                .getFiles()
                .find((f) => f.path === path);
            if (targetFile) {
                const leaf = app.workspace.getLeaf(false);
                await leaf.openFile(targetFile);
            } else {
                Logger("The file could not view on the editor", LOG_LEVEL_NOTICE)
            }
        }
        buttons.createEl("button", { text: "Back to this revision" }, (e) => {
            e.addClass("mod-cta");
            e.addEventListener("click", async () => {
                // const pathToWrite = this.plugin.id2path(this.id, true);
                const pathToWrite = stripPrefix(this.file);
                if (!isValidPath(pathToWrite)) {
                    Logger("Path is not valid to write content.", LOG_LEVEL_INFO);
                }
                if (this.currentDoc?.datatype == "plain") {
                    await this.plugin.vaultAccess.adapterWrite(pathToWrite, getDocData(this.currentDoc.data));
                    await focusFile(pathToWrite);
                    this.close();
                } else if (this.currentDoc?.datatype == "newnote") {
                    await this.plugin.vaultAccess.adapterWrite(pathToWrite, decodeBinary(this.currentDoc.data));
                    await focusFile(pathToWrite);
                    this.close();
                } else {

                    Logger(`Could not parse entry`, LOG_LEVEL_NOTICE);
                }
            });
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
