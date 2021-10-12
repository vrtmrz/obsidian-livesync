import { App, debounce, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, Vault, DataWriteOptions, View } from "obsidian";
import { PouchDB } from "./pouchdb-browser-webpack/dist/pouchdb-browser";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "diff-match-patch";

interface ObsidianLiveSyncSettings {
    couchDB_URI: string;
    couchDB_USER: string;
    couchDB_PASSWORD: string;
    liveReload: boolean;
    syncOnSave: boolean;
    syncOnStart: boolean;
}

const DEFAULT_SETTINGS: ObsidianLiveSyncSettings = {
    couchDB_URI: "",
    couchDB_USER: "",
    couchDB_PASSWORD: "",
    liveReload: false,
    syncOnSave: false,
    syncOnStart: false,
};

interface Notes {
    _id: string;
    data: string;
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
}
interface PouchChanged {
    id: string;
    doc: Notes;
}
interface method_result<T> {
    stat: boolean;
    value: T;
}
type diff_result_leaf = {
    rev: string;
    data: string;
    ctime: number;
    mtime: number;
};
type dmp_result = Array<[number, string]>;

type diff_result = {
    left: diff_result_leaf;
    right: diff_result_leaf;
    diff: dmp_result;
};
type diff_check_result = boolean | diff_result;

//-->Functions.
function arrayBufferToBase64(buffer: ArrayBuffer) {
    var binary = "";
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    try {
        var binary_string = window.atob(base64);
        var len = binary_string.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    } catch (ex) {
        return null;
    }
}
function base64ToString(base64: string): string {
    try {
        var binary_string = window.atob(base64);
        var len = binary_string.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    } catch (ex) {
        return null;
    }
}

const escapeStringToHTML = (str: string) => {
    if (!str) return;
    return str.replace(/[<>&"'`]/g, (match) => {
        const escape: any = {
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&#39;",
            "`": "&#x60;",
        };
        return escape[match];
    });
};
//<--Functions

export default class ObsidianLiveSyncPlugin extends Plugin {
    settings: ObsidianLiveSyncSettings;
    localDatabase: PouchDB.Database<Notes>;
    logMessage: string[] = [];

    async addLog(message: any) {
        let timestamp = new Date().toLocaleString();
        let newmessage = timestamp + "->" + (typeof message == "string" ? message : JSON.stringify(message, null, 2));

        this.logMessage = [].concat(this.logMessage).concat([newmessage]).slice(-100);
        // this.logMessage = [...this.logMessage, timestamp + ":" + newmessage].slice(-100);
        console.log(newmessage);
        if (this.statusBar2 != null) {
            this.statusBar2.setText(newmessage);
        }
    }

    async ensureDirectory(fullpath: string) {
        let pathElements = fullpath.split("/");
        pathElements.pop();
        let c = "";
        for (var v of pathElements) {
            c += v;
            try {
                await this.app.vault.createFolder(c);
            } catch (ex) {
                this.addLog("ensure excep");
                this.addLog(ex);
            }
            c += "/";
        }
    }

    async doc2storage_create(doc: Notes, force?: boolean) {
        let bin = base64ToArrayBuffer(doc.data);
        if (bin != null) {
            await this.ensureDirectory(doc._id);
            let newfile = await this.app.vault.createBinary(doc._id, bin, { ctime: doc.ctime, mtime: doc.mtime });
            this.addLog("live : write to local (newfile) " + doc._id);
            await this.app.vault.trigger("create", newfile);
        }
    }
    async doc2storate_modify(doc: Notes, file: TFile, force?: boolean) {
        if (doc._deleted) {
            //basically pass.
            //but if there're no docs left, delete file.
            try {
                let lastDocs = this.localDatabase.get(doc._id);
                this.addLog(`delete skipped:${doc._id}`);
            } catch (ex) {
                if (ex.status || ex.status == 404) {
                    //no op.
                    await this.app.vault.delete(file);
                }
            }
            return;
        }

        if (file.stat.mtime < doc.mtime || force) {
            let bin = base64ToArrayBuffer(doc.data);
            if (bin != null) {
                await this.app.vault.modifyBinary(file, bin, { ctime: doc.ctime, mtime: doc.mtime });
                this.addLog("livesync : newer local files so write to local:" + file.path);
                await this.app.vault.trigger("modify", file);
            }
        } else if (file.stat.mtime > doc.mtime) {
            // newer local file.
            // ?
        } else {
            //Nothing have to op.
            //eq.case
        }
    }
    async pouchdbChanged(change: Notes) {
        let allfiles = this.app.vault.getFiles();
        let targetFiles = allfiles.filter((e) => e.path == change._id);
        if (targetFiles.length == 0) {
            if (change._deleted) {
                return;
            }
            let doc = change;
            await this.doc2storage_create(doc);
        }
        if (targetFiles.length == 1) {
            let doc = change;
            let file = targetFiles[0];
            await this.doc2storate_modify(doc, file);
            await this.showIfConflicted(file);
        }
    }

    //---> Sync
    syncHandler: PouchDB.Replication.Sync<{}> = null;
    async enableSync() {
        if (this.syncHandler != null) {
            return false;
        }
        let db = new PouchDB(this.settings.couchDB_URI, {
            auth: {
                username: this.settings.couchDB_USER,
                password: this.settings.couchDB_PASSWORD,
            },
        });
        try {
            let info = await db.info();
        } catch (ex) {
            return;
        }
        this.syncHandler = this.localDatabase.sync(db, { live: true, retry: true });

        this.syncHandler
            .on("change", async (e) => {
                let docs = e.change.docs;
                for (var change of docs) {
                    await this.pouchdbChanged(change as Notes);
                }
                localStorage.setItem("last-sync-no", e.change.last_seq + "");
                // new Notice(`changed:${JSON.stringify(e)}`);
            })
            .on("active", () => {
                // new Notice(`Replication activated`);
            })
            .on("complete", (e) => {
                new Notice(`Replication completed`);
            })
            .on("denied", (e) => {
                new Notice(`Replication denied`);
            })
            .on("error", (e) => {
                new Notice(`Replication error`);
            })
            .on("paused", (e) => {
                // new Notice(`Replication paused`);
            });
        this.refreshStatusText();
    }
    disableSync() {
        if (this.syncHandler == null) {
            return;
        }
        this.syncHandler.cancel();
        this.syncHandler.removeAllListeners();
        this.syncHandler = null;
        this.refreshStatusText();
    }
    async toggleSync() {
        if (this.syncHandler != null) {
            await this.disableSync();
        } else {
            await this.enableSync();
        }
    }
    async realizeSettingSyncMode() {
        await this.disableSync();
        if (this.settings.liveReload) {
            await this.enableSync();
        }
    }
    refreshStatusText() {
        let statusStr = "";
        if (this.syncHandler == null) {
            statusStr = "disabled";
        } else {
            statusStr = "enabled";
        }
        this.statusBar.setText("Sync:" + statusStr);
    }
    async initializeDatabase() {
        // debugger;
        let vaultName = this.app.vault.getName();

        this.localDatabase = new PouchDB<Notes>(vaultName + "-livesync", {
            auto_compaction: true,
            revs_limit: 100,
            deterministic_revs: true,
        });

        await this.syncAllFiles();
    }
    statusBar: HTMLElement;
    statusBar2: HTMLElement;
    //<-- Sync
    async replicate() {
        let db = new PouchDB(this.settings.couchDB_URI, {
            auth: {
                username: this.settings.couchDB_USER,
                password: this.settings.couchDB_PASSWORD,
            },
        });
        try {
            var info = await db.info();
            new Notice(`Connected to ${info.db_name}`);
            this.localDatabase
                .sync(db, {
                    // batch_size: 250,
                    // since: "0",
                })
                .on("change", async (e) => {
                    // debugger;

                    let docs = e.change.docs;
                    for (var change of docs) {
                        this.addLog("replication change arrived");
                        this.addLog(change);
                        await this.pouchdbChanged(change as Notes);
                    }
                    localStorage.setItem("last-sync-no", e.change.last_seq + "");
                    // this.addLog(e.change.last_seq);
                    // new Notice(`changed:${JSON.stringify(e)}`);
                })
                .on("active", () => {
                    new Notice(`Replication activated`);
                })
                .on("complete", (e) => {
                    new Notice(`Replication completed`);
                })
                .on("denied", (e) => {
                    new Notice(`Replication denied`);
                })
                .on("error", (e) => {
                    new Notice(`Replication error`);
                })
                .on("paused", (e) => {
                    new Notice(`Replication paused`);
                });
        } catch (ex) {
            new Notice("Could not connect to db");
        }
    }
    async onload() {
        this.addLog("loading plugin");

        await this.loadSettings();

        this.addRibbonIcon("dice", "Replicate", async () => {
            await this.replicate();
        });

        this.addRibbonIcon("dice", "pull file force", async () => {
            this.localDatabase
                .changes({
                    since: 0,
                    include_docs: true,
                })
                .on("change", async (change) => {
                    await this.pouchdbChanged(change.doc);
                    localStorage.setItem("last-sync-no", change.seq + "");
                    // received a change
                })
                .on("error", function (err) {
                    // handle errors
                });
        });
        this.addRibbonIcon("dice", "Toggle Sync", () => {
            this.toggleSync();
            // Vault.recurseChildren();
        });
        this.statusBar = this.addStatusBarItem();
        this.statusBar2 = this.addStatusBarItem();

        this.watchVaultChange = debounce(this.watchVaultChange.bind(this), 200, false);
        this.watchVaultDelete = debounce(this.watchVaultDelete.bind(this), 200, false);
        this.watchVaultRename = debounce(this.watchVaultRename.bind(this), 200, false);
        this.watchWorkspaceOpen = debounce(this.watchWorkspaceOpen.bind(this), 200, false);
        this.registerWatchEvents();

        this.addSettingTab(new ObsidianLiveSyncSettingTab(this.app, this));

        setTimeout(async () => {
            await this.initializeDatabase();
            this.realizeSettingSyncMode();
            if (this.settings.syncOnStart) {
                await this.replicate();
            }
        }, 100);
    }

    onunload() {
        this.addLog("unloading plugin");
        this.disableSync();
    }

    async syncAllFiles() {
        // synchronize all files between database and storage.
        const filesStorage = this.app.vault.getFiles();
        const filesStorageName = filesStorage.map((e) => e.path);
        const wf = await this.localDatabase.allDocs();
        const filesDatabase = wf.rows.map((e) => e.id);

        const onlyInStorage = filesStorage.filter((e) => filesDatabase.indexOf(e.path) == -1);
        const onlyInDatabase = filesDatabase.filter((e) => filesStorageName.indexOf(e) == -1);
        //simply realize it
        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        //have to sync below..
        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);

        for (let v of onlyInStorage) {
            await this.updateDB(v);
        }
        for (let v of onlyInDatabase) {
            await this.pullFile(v, filesStorage);
        }

        for (let v of syncFiles) {
            await this.syncFileBetweenDBandStorage(v, filesStorage);
        }
    }

    registerWatchEvents() {
        this.registerEvent(this.app.vault.on("modify", this.watchVaultChange));
        this.registerEvent(this.app.vault.on("delete", this.watchVaultDelete));
        this.registerEvent(this.app.vault.on("rename", this.watchVaultRename));
        this.registerEvent(this.app.vault.on("create", this.watchVaultChange));
        this.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
    }
    watchWorkspaceOpen(file: TFile) {
        this.showIfConflicted(file);
    }
    watchVaultChange(file: TFile, ...args: any[]) {
        this.updateDB(file);
    }
    watchVaultDelete(file: TFile) {
        this.deleteDB(file);
    }
    watchVaultRename(file: any, oldFile: any) {
        this.updateDB(file);
        this.deleteDBbyPath(oldFile);
    }

    // --> conflict resolving
    async getConflictedDoc(path: string, rev: string): Promise<false | diff_result_leaf> {
        try {
            let doc = await this.localDatabase.get(path, { rev: rev });
            return {
                ctime: doc.ctime,
                mtime: doc.mtime,
                rev: rev,
                data: base64ToString(doc.data),
            };
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
        }
        return false;
    }
    async getConflictedStatus(path: string): Promise<diff_check_result> {
        let test = await this.localDatabase.get(path, { conflicts: true });
        if (!test._conflicts) return false;
        if (test._conflicts.length == 0) return false;
        // should be two or more conflicts;
        let leftLeaf = await this.getConflictedDoc(path, test._rev);
        let rightLeaf = await this.getConflictedDoc(path, test._conflicts[0]);
        if (leftLeaf === false) return false;
        if (rightLeaf === false) return false;
        // first,check for same contents
        if (leftLeaf.data == rightLeaf.data) {
            let leaf = leftLeaf;
            if (leftLeaf.mtime > rightLeaf.mtime) {
                leaf = rightLeaf;
            }
            await this.localDatabase.remove(path, leaf.rev);
            await this.pullFile(path, null, true);
            this.addLog(`automaticaly merged:${path}`);
            return true;
            // }
        }
        let dmp = new diff_match_patch();
        var diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
        dmp.diff_cleanupSemantic(diff);
        this.addLog(`conflict(s) found:${path}`);
        return {
            left: leftLeaf,
            right: rightLeaf,
            diff: diff,
        };
    }
    async showIfConflicted(file: TFile) {
        let conflictCheckResult = await this.getConflictedStatus(file.path);
        if (conflictCheckResult === false) return; //nothign to do.
        if (conflictCheckResult === true) {
            //auto resolved, but need check again;
            setTimeout(() => {
                this.showIfConflicted(file);
            }, 50);
            return;
        }
        //there conflicts, and have to resolve ;
        let leaf = this.app.workspace.activeLeaf;
        if (leaf) {
            new ConflictResolveModal(this.app, conflictCheckResult, async (selected) => {
                let toDelete = selected;
                if (toDelete == "") {
                    return;
                }
                this.addLog(`resolved conflict:${file.path}`);
                await this.localDatabase.remove(file.path, toDelete);
                await this.pullFile(file.path, null, true);
                setTimeout(() => {
                    //resolved, check again.
                    this.showIfConflicted(file);
                }, 50);
            }).open();
        }
    }
    async pullFile(filename: string, fileList?: TFile[], force?: boolean) {
        if (!fileList) {
            fileList = this.app.vault.getFiles();
        }
        let targetFiles = fileList.filter((e) => e.path == filename);
        if (targetFiles.length == 0) {
            //have to create;
            let doc = await this.localDatabase.get(filename);
            await this.doc2storage_create(doc, force);
        } else if (targetFiles.length == 1) {
            //normal case
            let file = targetFiles[0];
            let doc = await this.localDatabase.get(filename);
            await this.doc2storate_modify(doc, file, force);
        } else {
            //something went wrong..
        }
        //when to opened file;
    }
    async syncFileBetweenDBandStorage(file: TFile, fileList?: TFile[]) {
        let doc = await this.localDatabase.get(file.path);
        if (file.stat.mtime > doc.mtime) {
            //newer local file.
            await this.updateDB(file);
            this.addLog("sync : older databse files so write to database:" + file.path);
        } else if (file.stat.mtime < doc.mtime) {
            //newer database file.
            this.addLog("sync : older storage files so write from database:" + file.path);
            await this.doc2storate_modify(doc, file);
        } else {
            //eq.case
        }
    }

    async updateDB(file: TFile) {
        let contentBin = await this.app.vault.readBinary(file);
        let content = arrayBufferToBase64(contentBin);
        let fullpath = file.path;
        let d: Notes = {
            _id: fullpath,
            data: content,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size,
        };
        try {
            let old = await this.localDatabase.get(fullpath);
            let oldData = { data: old.data };
            let newData = { data: d.data };
            if (JSON.stringify(oldData) == JSON.stringify(newData)) {
                this.addLog("no changed" + fullpath);
                return;
            }
            d._rev = old._rev;
        } catch (ex) {
            if (ex.status == 404) {
                //NO OP
            } else {
                throw ex;
            }
        }
        let ret = await this.localDatabase.put(d);

        this.addLog("put database " + fullpath);
        this.addLog(ret);
        if (this.settings.syncOnSave) {
            await this.replicate();
        }
    }
    async deleteDB(file: TFile) {
        let fullpath = file.path;
        this.addLog(`deleteDB By path:${fullpath}`);
        await this.deleteDBbyPath(fullpath);
        if (this.settings.syncOnSave) {
            await this.replicate();
        }
    }
    async deleteDBbyPath(fullpath: string) {
        try {
            let old = await this.localDatabase.get(fullpath);
            old._deleted = true;
            await this.localDatabase.put(old);
            this.addLog("deleted:" + fullpath);
        } catch (ex) {
            if (ex.status == 404) {
                //NO OP
                return;
            } else {
                throw ex;
            }
        }
        if (this.settings.syncOnSave) {
            await this.replicate();
        }
    }

    async resetLocalDatabase() {
        await this.disableSync();
        await this.localDatabase.destroy();
        await this.initializeDatabase();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
class LogDisplayModal extends Modal {
    constructor(app: App) {
        super(app);
    }
}
class ConflictResolveModal extends Modal {
    // result: Array<[number, string]>;
    result: diff_result;
    callback: (remove_rev: string) => Promise<void>;
    constructor(app: App, diff: diff_result, callback: (remove_rev: string) => Promise<void>) {
        super(app);
        this.result = diff;
        this.callback = callback;
    }

    onOpen() {
        let { contentEl } = this;

        contentEl.empty();

        contentEl.createEl("h2", { text: "This document has conflicted changes." });
        let div = contentEl.createDiv("");
        div.addClass("op-scrollable");
        let diff = "";
        // const showContents = this.result.map((e) => (e[0] == 1 ? "<span class='added'>" + htmlEscape(e[1]) + "</span>" : e[0] == -1 ? "<span class='deleted'>" + htmlEscape(e[1]) + "</span>" : "<span class='normal'>" + htmlEscape(e[1]) + "</span>"));
        for (let v of this.result.diff) {
            let x1 = v[0];
            let x2 = v[1];
            if (x1 == DIFF_DELETE) {
                diff += "<span class='deleted'>" + escapeStringToHTML(x2) + "</span>";
            } else if (x1 == DIFF_EQUAL) {
                diff += "<span class='normal'>" + escapeStringToHTML(x2) + "</span>";
            } else if (x1 == DIFF_INSERT) {
                diff += "<span class='added'>" + escapeStringToHTML(x2) + "</span>";
            }
        }

        diff = diff.replace(/\n/g, "<br>");
        div.innerHTML = diff;
        let div2 = contentEl.createDiv("");
        let date1 = new Date(this.result.left.mtime).toLocaleString();
        let date2 = new Date(this.result.right.mtime).toLocaleString();
        div2.innerHTML = `
<span class='deleted'>A:${date1}</span><br /><span class='added'>B:${date2}</span><br> 
        `;
        contentEl.createEl("button", { text: "Keep A" }, (e) => {
            e.addEventListener("click", async () => {
                await this.callback(this.result.right.rev);
                this.close();
            });
        });
        contentEl.createEl("button", { text: "Keep B" }, (e) => {
            e.addEventListener("click", async () => {
                await this.callback(this.result.left.rev);
                this.close();
            });
        });
        contentEl.createEl("button", { text: "Not now" }, (e) => {
            e.addEventListener("click", async () => {
                this.close();
            });
        });
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    async test(): Promise<void> {
        let db = new PouchDB(this.plugin.settings.couchDB_URI, {
            auth: {
                username: this.plugin.settings.couchDB_USER,
                password: this.plugin.settings.couchDB_PASSWORD,
            },
        });
        try {
            var info = await db.info();
            new Notice(`Connected to ${info.db_name}`);
        } catch (ex) {
            new Notice("Could not connect to db:" + ex);
        }
    }
    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        containerEl.createEl("h2", { text: "Settings for obsidian-livesync." });

        new Setting(containerEl)
            .setName("CouchDB Remote URI")
            .setDesc("It's a secret")
            .addText((text) =>
                text
                    .setPlaceholder("https://........")
                    .setValue(this.plugin.settings.couchDB_URI)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_URI = value;
                        await this.plugin.saveSettings();
                    })
            );
        new Setting(containerEl)
            .setName("CouchDB Username")
            .setDesc("username")
            .addText((text) =>
                text
                    .setPlaceholder("")
                    .setValue(this.plugin.settings.couchDB_USER)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_USER = value;
                        await this.plugin.saveSettings();
                    })
            );
        new Setting(containerEl)
            .setName("CouchDB Password")
            .setDesc("password")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.couchDB_PASSWORD)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_PASSWORD = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "password");
            });
        new Setting(containerEl).setName("Test DB").addButton((button) =>
            button
                .setButtonText("Test Database Connection")
                .setDisabled(false)
                .onClick(async () => {
                    await this.test();
                })
        );

        new Setting(containerEl)
            .setName("LiveSync")
            .setDesc("Sync realtime")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.liveReload).onChange(async (value) => {
                    this.plugin.settings.liveReload = value;
                    await this.plugin.saveSettings();
                    this.plugin.realizeSettingSyncMode();
                })
            );
        new Setting(containerEl)
            .setName("Sync on Save")
            .setDesc("Sync on Save")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
                    this.plugin.settings.syncOnSave = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("Sync on Start")
            .setDesc("Sync on Start")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (value) => {
                    this.plugin.settings.syncOnStart = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("Database Operations")
            .addButton((button) =>
                button
                    .setButtonText("Reset local database")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.resetLocalDatabase();
                        //await this.test();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Reset local files")
                    .setDisabled(false)
                    .onClick(async () => {
                        //await this.test();
                    })
            );
    }
}
