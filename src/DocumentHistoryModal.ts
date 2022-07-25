import { TFile, Modal, App } from "obsidian";
import { path2id } from "./utils";
import { base64ToArrayBuffer, base64ToString, escapeStringToHTML, isValidPath } from "./lib/src/utils";
import ObsidianLiveSyncPlugin from "./main";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "diff-match-patch";
import { LoadedEntry, LOG_LEVEL } from "./lib/src/types";
import { Logger } from "./lib/src/logger";

export class DocumentHistoryModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    range: HTMLInputElement;
    contentView: HTMLDivElement;
    info: HTMLDivElement;
    fileInfo: HTMLDivElement;
    showDiff = false;

    file: string;

    revs_info: PouchDB.Core.RevisionInfo[] = [];
    currentDoc: LoadedEntry;
    currentText = "";

    constructor(app: App, plugin: ObsidianLiveSyncPlugin, file: TFile | string) {
        super(app);
        this.plugin = plugin;
        this.file = (file instanceof TFile) ? file.path : file;
        if (localStorage.getItem("ols-history-highlightdiff") == "1") {
            this.showDiff = true;
        }
    }
    async loadFile() {
        const db = this.plugin.localDatabase;
        const w = await db.localDatabase.get(path2id(this.file), { revs_info: true });
        this.revs_info = w._revs_info.filter((e) => e.status == "available");
        this.range.max = `${this.revs_info.length - 1}`;
        this.range.value = this.range.max;
        this.fileInfo.setText(`${this.file} / ${this.revs_info.length} revisions`);
        await this.loadRevs();
    }
    async loadRevs() {
        const db = this.plugin.localDatabase;
        const index = this.revs_info.length - 1 - (this.range.value as any) / 1;
        const rev = this.revs_info[index];
        const w = await db.getDBEntry(path2id(this.file), { rev: rev.rev }, false, false);
        this.currentText = "";

        if (w === false) {
            this.info.innerHTML = "";
            this.contentView.innerHTML = `Could not read this revision<br>(${rev.rev})`;
        } else {
            this.currentDoc = w;
            this.info.innerHTML = `Modified:${new Date(w.mtime).toLocaleString()}`;
            let result = "";
            const w1data = w.datatype == "plain" ? w.data : base64ToString(w.data);

            this.currentText = w1data;
            if (this.showDiff) {
                const prevRevIdx = this.revs_info.length - 1 - ((this.range.value as any) / 1 - 1);
                if (prevRevIdx >= 0 && prevRevIdx < this.revs_info.length) {
                    const oldRev = this.revs_info[prevRevIdx].rev;
                    const w2 = await db.getDBEntry(path2id(this.file), { rev: oldRev }, false, false);
                    if (w2 != false) {
                        const dmp = new diff_match_patch();
                        const w2data = w2.datatype == "plain" ? w2.data : base64ToString(w2.data);
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
            this.contentView.innerHTML = result;
        }
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();
        contentEl.createEl("h2", { text: "Document History" });
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
        this.loadFile();
        const div = contentEl.createDiv({ text: "Loading old revisions..." });
        this.contentView = div;
        div.addClass("op-scrollable");
        div.addClass("op-pre");
        const buttons = contentEl.createDiv("");
        buttons.createEl("button", { text: "Copy to clipboard" }, (e) => {
            e.addClass("mod-cta");
            e.addEventListener("click", async () => {
                await navigator.clipboard.writeText(this.currentText);
                Logger(`Old content copied to clipboard`, LOG_LEVEL.NOTICE);
            });
        });
        buttons.createEl("button", { text: "Back to this revision" }, (e) => {
            e.addClass("mod-cta");
            e.addEventListener("click", async () => {
                const pathToWrite = this.file.startsWith("i:") ? this.file.substring("i:".length) : this.file;
                if (!isValidPath(pathToWrite)) {
                    Logger("Path is not vaild to write content.", LOG_LEVEL.INFO);
                }
                if (this.currentDoc?.datatype == "plain") {
                    await this.app.vault.adapter.write(pathToWrite, this.currentDoc.data);
                    this.close();
                } else if (this.currentDoc?.datatype == "newnote") {
                    await this.app.vault.adapter.writeBinary(pathToWrite, base64ToArrayBuffer(this.currentDoc.data));
                    this.close();
                } else {

                    Logger(`Could not parse entry`, LOG_LEVEL.NOTICE);
                }
            });
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
