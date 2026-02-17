import { stringifyYaml } from "../../../deps.ts";
import {
    type ObsidianLiveSyncSettings,
    type FilePathWithPrefix,
    type DocumentID,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LoadedEntry,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    type MetaEntry,
    type FilePath,
    DEFAULT_SETTINGS,
} from "../../../lib/src/common/types.ts";
import {
    createBlob,
    getFileRegExp,
    isDocContentSame,
    parseHeaderValues,
    readAsBlob,
} from "../../../lib/src/common/utils.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { isCloudantURI } from "../../../lib/src/pouchdb/utils_couchdb.ts";
import { requestToCouchDBWithCredentials } from "../../../common/utils.ts";
import { addPrefix, shouldBeIgnored, stripAllPrefixes } from "../../../lib/src/string_and_binary/path.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import {
    EVENT_ANALYSE_DB_USAGE,
    EVENT_REQUEST_CHECK_REMOTE_SIZE,
    EVENT_REQUEST_RUN_DOCTOR,
    EVENT_REQUEST_RUN_FIX_INCOMPLETE,
    eventHub,
} from "../../../common/events.ts";
import { ICHeader, ICXHeader, PSCHeader } from "../../../common/types.ts";
import { HiddenFileSync } from "../../../features/HiddenFileSync/CmdHiddenFileSync.ts";
import { EVENT_REQUEST_SHOW_HISTORY } from "../../../common/obsidianEvents.ts";
import { generateCredentialObject } from "../../../lib/src/replication/httplib.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
export function paneHatch(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    // const hatchWarn = this.createEl(paneEl, "div", { text: `To stop the boot up sequence for fixing problems on databases, you can put redflag.md on top of your vault (Rebooting obsidian is required).` });
    // hatchWarn.addClass("op-warn-info");
    void addPanel(paneEl, $msg("Setting.TroubleShooting")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Setting.TroubleShooting.Doctor"))
            .setDesc($msg("Setting.TroubleShooting.Doctor.Desc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Run Doctor"))
                    .setCta()
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_RUN_DOCTOR, "you wanted(Thank you)!");
                    })
            );
        new Setting(paneEl)
            .setName($msg("Setting.TroubleShooting.ScanBrokenFiles"))
            .setDesc($msg("Setting.TroubleShooting.ScanBrokenFiles.Desc"))
            .addButton((button) =>
                button
                    .setButtonText("Scan for Broken files")
                    .setCta()
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_RUN_FIX_INCOMPLETE);
                    })
            );
        new Setting(paneEl).setName($msg("Prepare the 'report' to create an issue")).addButton((button) =>
            button
                .setButtonText($msg("Copy Report to clipboard"))
                .setCta()
                .setDisabled(false)
                .onClick(async () => {
                    let responseConfig: any = {};
                    const REDACTED = "𝑅𝐸𝐷𝐴𝐶𝑇𝐸𝐷";
                    if (this.editingSettings.remoteType == REMOTE_COUCHDB) {
                        try {
                            const credential = generateCredentialObject(this.editingSettings);
                            const customHeaders = parseHeaderValues(this.editingSettings.couchDB_CustomHeaders);
                            const r = await requestToCouchDBWithCredentials(
                                this.editingSettings.couchDB_URI,
                                credential,
                                window.origin,
                                undefined,
                                undefined,
                                undefined,
                                customHeaders
                            );

                            Logger(JSON.stringify(r.json, null, 2));

                            responseConfig = r.json;
                            responseConfig["couch_httpd_auth"].secret = REDACTED;
                            responseConfig["couch_httpd_auth"].authentication_db = REDACTED;
                            responseConfig["couch_httpd_auth"].authentication_redirect = REDACTED;
                            responseConfig["couchdb"].uuid = REDACTED;
                            responseConfig["admins"] = REDACTED;
                            delete responseConfig["jwt_keys"];
                            if ("secret" in responseConfig["chttpd_auth"])
                                responseConfig["chttpd_auth"].secret = REDACTED;
                        } catch (ex) {
                            Logger(ex, LOG_LEVEL_VERBOSE);
                            responseConfig = {
                                error: "Requesting information from the remote CouchDB has failed. If you are using IBM Cloudant, this is normal behaviour.",
                            };
                        }
                    } else if (this.editingSettings.remoteType == REMOTE_MINIO) {
                        responseConfig = { error: "Object Storage Synchronisation" };
                        //
                    }
                    const defaultKeys = Object.keys(DEFAULT_SETTINGS) as (keyof ObsidianLiveSyncSettings)[];
                    const pluginConfig = JSON.parse(JSON.stringify(this.editingSettings)) as ObsidianLiveSyncSettings;
                    const pluginKeys = Object.keys(pluginConfig);
                    for (const key of pluginKeys) {
                        if (defaultKeys.includes(key as any)) continue;
                        delete pluginConfig[key as keyof ObsidianLiveSyncSettings];
                    }

                    pluginConfig.couchDB_DBNAME = REDACTED;
                    pluginConfig.couchDB_PASSWORD = REDACTED;
                    const scheme = pluginConfig.couchDB_URI.startsWith("http:")
                        ? "(HTTP)"
                        : pluginConfig.couchDB_URI.startsWith("https:")
                          ? "(HTTPS)"
                          : "";
                    pluginConfig.couchDB_URI = isCloudantURI(pluginConfig.couchDB_URI)
                        ? "cloudant"
                        : `self-hosted${scheme}`;
                    pluginConfig.couchDB_USER = REDACTED;
                    pluginConfig.passphrase = REDACTED;
                    pluginConfig.encryptedPassphrase = REDACTED;
                    pluginConfig.encryptedCouchDBConnection = REDACTED;
                    pluginConfig.accessKey = REDACTED;
                    pluginConfig.secretKey = REDACTED;
                    const redact = (source: string) => `${REDACTED}(${source.length} letters)`;
                    pluginConfig.region = redact(pluginConfig.region);
                    pluginConfig.bucket = redact(pluginConfig.bucket);
                    pluginConfig.pluginSyncExtendedSetting = {};
                    pluginConfig.P2P_AppID = redact(pluginConfig.P2P_AppID);
                    pluginConfig.P2P_passphrase = redact(pluginConfig.P2P_passphrase);
                    pluginConfig.P2P_roomID = redact(pluginConfig.P2P_roomID);
                    pluginConfig.P2P_relays = redact(pluginConfig.P2P_relays);
                    pluginConfig.jwtKey = redact(pluginConfig.jwtKey);
                    pluginConfig.jwtSub = redact(pluginConfig.jwtSub);
                    pluginConfig.jwtKid = redact(pluginConfig.jwtKid);
                    pluginConfig.bucketCustomHeaders = redact(pluginConfig.bucketCustomHeaders);
                    pluginConfig.couchDB_CustomHeaders = redact(pluginConfig.couchDB_CustomHeaders);
                    pluginConfig.P2P_turnCredential = redact(pluginConfig.P2P_turnCredential);
                    pluginConfig.P2P_turnUsername = redact(pluginConfig.P2P_turnUsername);
                    pluginConfig.P2P_turnServers = `(${pluginConfig.P2P_turnServers.split(",").length} servers configured)`;
                    const endpoint = pluginConfig.endpoint;
                    if (endpoint == "") {
                        pluginConfig.endpoint = "Not configured or AWS";
                    } else {
                        const endpointScheme = pluginConfig.endpoint.startsWith("http:")
                            ? "(HTTP)"
                            : pluginConfig.endpoint.startsWith("https:")
                              ? "(HTTPS)"
                              : "";
                        pluginConfig.endpoint = `${endpoint.indexOf(".r2.cloudflarestorage.") !== -1 ? "R2" : "self-hosted?"}(${endpointScheme})`;
                    }
                    const obsidianInfo = {
                        navigator: navigator.userAgent,
                        fileSystem: this.plugin.services.vault.isStorageInsensitive() ? "insensitive" : "sensitive",
                    };
                    const msgConfig = `# ---- Obsidian info ----
${stringifyYaml(obsidianInfo)}
---
# ---- remote config ----
${stringifyYaml(responseConfig)}
---
# ---- Plug-in config ----
${stringifyYaml({
    version: this.manifestVersion,
    ...pluginConfig,
})}`;
                    console.log(msgConfig);
                    if ((await this.services.UI.promptCopyToClipboard("Generated report", msgConfig)) == true) {
                        // await navigator.clipboard.writeText(msgConfig);
                        // Logger(
                        //     `Generated report has been copied to clipboard. Please report the issue with this! Thank you for your cooperation!`,
                        //     LOG_LEVEL_NOTICE
                        // );
                    }
                })
        );
        new Setting(paneEl)
            .setName($msg("Analyse database usage"))
            .setDesc(
                $msg(
                    "Analyse database usage and generate a TSV report for diagnosis yourself. You can paste the generated report with any spreadsheet you like."
                )
            )
            .addButton((button) =>
                button.setButtonText($msg("Analyse")).onClick(() => {
                    eventHub.emitEvent(EVENT_ANALYSE_DB_USAGE);
                })
            );
        new Setting(paneEl)
            .setName($msg("Reset notification threshold and check the remote database usage"))
            .setDesc($msg("Reset the remote storage size threshold and check the remote storage size again."))
            .addButton((button) =>
                button.setButtonText($msg("Check")).onClick(() => {
                    eventHub.emitEvent(EVENT_REQUEST_CHECK_REMOTE_SIZE);
                })
            );
        new Setting(paneEl).autoWireToggle("writeLogToTheFile");
    });

    void addPanel(paneEl, "Scram Switches").then((paneEl) => {
        new Setting(paneEl).autoWireToggle("suspendFileWatching");
        this.addOnSaved("suspendFileWatching", () => this.services.appLifecycle.askRestart());

        new Setting(paneEl).autoWireToggle("suspendParseReplicationResult");
        this.addOnSaved("suspendParseReplicationResult", () => this.services.appLifecycle.askRestart());
    });

    void addPanel(paneEl, "Recovery and Repair").then((paneEl) => {
        const addResult = async (path: string, file: FilePathWithPrefix | false, fileOnDB: LoadedEntry | false) => {
            const storageFileStat = file ? await this.plugin.storageAccess.statHidden(file) : null;
            resultArea.appendChild(
                this.createEl(resultArea, "div", {}, (el) => {
                    el.appendChild(this.createEl(el, "h6", { text: path }));
                    el.appendChild(
                        this.createEl(el, "div", {}, (infoGroupEl) => {
                            infoGroupEl.appendChild(
                                this.createEl(infoGroupEl, "div", {
                                    text: `Storage : Modified: ${!storageFileStat ? `Missing:` : `${new Date(storageFileStat.mtime).toLocaleString()}, Size:${storageFileStat.size}`}`,
                                })
                            );
                            infoGroupEl.appendChild(
                                this.createEl(infoGroupEl, "div", {
                                    text: `Database: Modified: ${!fileOnDB ? `Missing:` : `${new Date(fileOnDB.mtime).toLocaleString()}, Size:${fileOnDB.size} (actual size:${readAsBlob(fileOnDB).size})`}`,
                                })
                            );
                        })
                    );
                    if (fileOnDB && file) {
                        el.appendChild(
                            this.createEl(el, "button", { text: "Show history" }, (buttonEl) => {
                                buttonEl.onClickEvent(() => {
                                    eventHub.emitEvent(EVENT_REQUEST_SHOW_HISTORY, {
                                        file: file,
                                        fileOnDB: fileOnDB,
                                    });
                                });
                            })
                        );
                    }
                    if (file) {
                        el.appendChild(
                            this.createEl(el, "button", { text: "Storage -> Database" }, (buttonEl) => {
                                buttonEl.onClickEvent(async () => {
                                    if (file.startsWith(".")) {
                                        const addOn = this.plugin.getAddOn<HiddenFileSync>(HiddenFileSync.name);
                                        if (addOn) {
                                            const file = (await addOn.scanInternalFiles()).find((e) => e.path == path);
                                            if (!file) {
                                                Logger(
                                                    `Failed to find the file in the internal files: ${path}`,
                                                    LOG_LEVEL_NOTICE
                                                );
                                                return;
                                            }
                                            if (!(await addOn.storeInternalFileToDatabase(file, true))) {
                                                Logger(
                                                    `Failed to store the file to the database (Hidden file): ${file}`,
                                                    LOG_LEVEL_NOTICE
                                                );
                                                return;
                                            }
                                        }
                                    } else {
                                        if (!(await this.plugin.fileHandler.storeFileToDB(file as FilePath, true))) {
                                            Logger(
                                                `Failed to store the file to the database: ${file}`,
                                                LOG_LEVEL_NOTICE
                                            );
                                            return;
                                        }
                                    }
                                    el.remove();
                                });
                            })
                        );
                    }
                    if (fileOnDB) {
                        el.appendChild(
                            this.createEl(el, "button", { text: "Database -> Storage" }, (buttonEl) => {
                                buttonEl.onClickEvent(async () => {
                                    if (fileOnDB.path.startsWith(ICHeader)) {
                                        const addOn = this.plugin.getAddOn<HiddenFileSync>(HiddenFileSync.name);
                                        if (addOn) {
                                            if (
                                                !(await addOn.extractInternalFileFromDatabase(path as FilePath, true))
                                            ) {
                                                Logger(
                                                    `Failed to store the file to the database (Hidden file): ${file}`,
                                                    LOG_LEVEL_NOTICE
                                                );
                                                return;
                                            }
                                        }
                                    } else {
                                        if (
                                            !(await this.plugin.fileHandler.dbToStorage(
                                                fileOnDB as MetaEntry,
                                                null,
                                                true
                                            ))
                                        ) {
                                            Logger(
                                                `Failed to store the file to the storage: ${fileOnDB.path}`,
                                                LOG_LEVEL_NOTICE
                                            );
                                            return;
                                        }
                                    }
                                    el.remove();
                                });
                            })
                        );
                    }
                    return el;
                })
            );
        };

        const checkBetweenStorageAndDatabase = async (file: FilePathWithPrefix, fileOnDB: LoadedEntry) => {
            const dataContent = readAsBlob(fileOnDB);
            const content = createBlob(await this.plugin.storageAccess.readHiddenFileBinary(file));
            if (await isDocContentSame(content, dataContent)) {
                Logger(`Compare: SAME: ${file}`);
            } else {
                Logger(`Compare: CONTENT IS NOT MATCHED! ${file}`, LOG_LEVEL_NOTICE);
                void addResult(file, file, fileOnDB);
            }
        };
        new Setting(paneEl)
            .setName("Recreate missing chunks for all files")
            .setDesc("This will recreate chunks for all files. If there were missing chunks, this may fix the errors.")
            .addButton((button) =>
                button
                    .setButtonText("Recreate all")
                    .setCta()
                    .onClick(async () => {
                        await this.plugin.fileHandler.createAllChunks(true);
                    })
            );
        new Setting(paneEl)
            .setName("Resolve All conflicted files by the newer one")
            .setDesc(
                "Resolve all conflicted files by the newer one. Caution: This will overwrite the older one, and cannot resurrect the overwritten one."
            )
            .addButton((button) =>
                button
                    .setButtonText("Resolve All")
                    .setCta()
                    .onClick(async () => {
                        await this.services.conflict.resolveAllConflictedFilesByNewerOnes();
                    })
            );

        new Setting(paneEl)
            .setName("Verify and repair all files")
            .setDesc(
                "Compare the content of files between on local database and storage. If not matched, you will be asked which one you want to keep."
            )
            .addButton((button) =>
                button
                    .setButtonText("Verify all")
                    .setDisabled(false)
                    .setCta()
                    .onClick(async () => {
                        Logger("Start verifying all files", LOG_LEVEL_NOTICE, "verify");
                        const ignorePatterns = getFileRegExp(this.plugin.settings, "syncInternalFilesIgnorePatterns");
                        const targetPatterns = getFileRegExp(this.plugin.settings, "syncInternalFilesTargetPatterns");
                        this.plugin.localDatabase.clearCaches();
                        Logger("Start verifying all files", LOG_LEVEL_NOTICE, "verify");
                        const files = this.plugin.settings.syncInternalFiles
                            ? await this.plugin.storageAccess.getFilesIncludeHidden("/", targetPatterns, ignorePatterns)
                            : await this.plugin.storageAccess.getFileNames();
                        const documents = [] as FilePath[];

                        const adn = this.plugin.localDatabase.findAllDocs();
                        for await (const i of adn) {
                            const path = this.services.path.getPath(i);
                            if (path.startsWith(ICXHeader)) continue;
                            if (path.startsWith(PSCHeader)) continue;
                            if (!this.plugin.settings.syncInternalFiles && path.startsWith(ICHeader)) continue;
                            documents.push(stripAllPrefixes(path));
                        }
                        const allPaths = [...new Set([...documents, ...files])];
                        let i = 0;
                        const incProc = () => {
                            i++;
                            if (i % 25 == 0)
                                Logger(
                                    `Checking ${i}/${allPaths.length} files \n`,
                                    LOG_LEVEL_NOTICE,
                                    "verify-processed"
                                );
                        };
                        const semaphore = Semaphore(10);
                        const processes = allPaths.map(async (path) => {
                            try {
                                if (shouldBeIgnored(path)) {
                                    return incProc();
                                }
                                const stat = (await this.plugin.storageAccess.isExistsIncludeHidden(path))
                                    ? await this.plugin.storageAccess.statHidden(path)
                                    : false;
                                const fileOnStorage = stat != null ? stat : false;
                                if (!(await this.services.vault.isTargetFile(path))) return incProc();
                                const releaser = await semaphore.acquire(1);
                                if (fileOnStorage && this.services.vault.isFileSizeTooLarge(fileOnStorage.size))
                                    return incProc();
                                try {
                                    const isHiddenFile = path.startsWith(".");
                                    const dbPath = isHiddenFile ? addPrefix(path, ICHeader) : path;
                                    const fileOnDB = await this.plugin.localDatabase.getDBEntry(dbPath);
                                    if (fileOnDB && this.services.vault.isFileSizeTooLarge(fileOnDB.size))
                                        return incProc();

                                    if (!fileOnDB && fileOnStorage) {
                                        Logger(`Compare: Not found on the local database: ${path}`, LOG_LEVEL_NOTICE);
                                        void addResult(path, path, false);
                                        return incProc();
                                    }
                                    if (fileOnDB && !fileOnStorage) {
                                        Logger(`Compare: Not found on the storage: ${path}`, LOG_LEVEL_NOTICE);
                                        void addResult(path, false, fileOnDB);
                                        return incProc();
                                    }
                                    if (fileOnStorage && fileOnDB) {
                                        await checkBetweenStorageAndDatabase(path, fileOnDB);
                                    }
                                } catch (ex) {
                                    Logger(`Error while processing ${path}`, LOG_LEVEL_NOTICE);
                                    Logger(ex, LOG_LEVEL_VERBOSE);
                                } finally {
                                    releaser();
                                    incProc();
                                }
                            } catch (ex) {
                                Logger(`Error while processing without semaphore ${path}`, LOG_LEVEL_NOTICE);
                                Logger(ex, LOG_LEVEL_VERBOSE);
                            }
                        });
                        await Promise.all(processes);
                        Logger("done", LOG_LEVEL_NOTICE, "verify");
                        // Logger(`${i}/${files.length}\n`, LOG_LEVEL_NOTICE, "verify-processed");
                    })
            );
        const resultArea = paneEl.createDiv({ text: "" });
        new Setting(paneEl)
            .setName("Check and convert non-path-obfuscated files")
            .setDesc("")
            .addButton((button) =>
                button
                    .setButtonText("Perform")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        for await (const docName of this.plugin.localDatabase.findAllDocNames()) {
                            if (!docName.startsWith("f:")) {
                                const idEncoded = await this.services.path.path2id(docName as FilePathWithPrefix);
                                const doc = await this.plugin.localDatabase.getRaw(docName as DocumentID);
                                if (!doc) continue;
                                if (doc.type != "newnote" && doc.type != "plain") {
                                    continue;
                                }
                                if (doc?.deleted ?? false) continue;
                                const newDoc = { ...doc };
                                //Prepare converted data
                                newDoc._id = idEncoded;
                                newDoc.path = docName as FilePathWithPrefix;
                                // @ts-ignore
                                delete newDoc._rev;
                                try {
                                    const obfuscatedDoc = await this.plugin.localDatabase.getRaw(idEncoded, {
                                        revs_info: true,
                                    });
                                    // Unfortunately we have to delete one of them.
                                    // Just now, save it as a conflicted document.
                                    obfuscatedDoc._revs_info?.shift(); // Drop latest revision.
                                    const previousRev = obfuscatedDoc._revs_info?.shift(); // Use second revision.
                                    if (previousRev) {
                                        newDoc._rev = previousRev.rev;
                                    } else {
                                        //If there are no revisions, set the possibly unique one
                                        newDoc._rev =
                                            "1-" +
                                            `00000000000000000000000000000000${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}`.slice(
                                                -32
                                            );
                                    }
                                    const ret = await this.plugin.localDatabase.putRaw(newDoc, { force: true });
                                    if (ret.ok) {
                                        Logger(
                                            `${docName} has been converted as conflicted document`,
                                            LOG_LEVEL_NOTICE
                                        );
                                        doc._deleted = true;
                                        if ((await this.plugin.localDatabase.putRaw(doc)).ok) {
                                            Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                        }
                                        await this.services.conflict.queueCheckForIfOpen(docName as FilePathWithPrefix);
                                    } else {
                                        Logger(`Converting ${docName} Failed!`, LOG_LEVEL_NOTICE);
                                        Logger(ret, LOG_LEVEL_VERBOSE);
                                    }
                                } catch (ex: any) {
                                    if (ex?.status == 404) {
                                        // We can perform this safely
                                        if ((await this.plugin.localDatabase.putRaw(newDoc)).ok) {
                                            Logger(`${docName} has been converted`, LOG_LEVEL_NOTICE);
                                            doc._deleted = true;
                                            if ((await this.plugin.localDatabase.putRaw(doc)).ok) {
                                                Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                            }
                                        }
                                    } else {
                                        Logger(`Something went wrong while converting ${docName}`, LOG_LEVEL_NOTICE);
                                        Logger(ex, LOG_LEVEL_VERBOSE);
                                        // Something wrong.
                                    }
                                }
                            }
                        }
                        Logger(`Converting finished`, LOG_LEVEL_NOTICE);
                    })
            );
    });
    void addPanel(paneEl, "Reset").then((paneEl) => {
        new Setting(paneEl).setName("Back to non-configured").addButton((button) =>
            button
                .setButtonText("Back")
                .setDisabled(false)
                .onClick(async () => {
                    this.editingSettings.isConfigured = false;
                    await this.saveAllDirtySettings();
                    this.services.appLifecycle.askRestart();
                })
        );

        new Setting(paneEl).setName("Delete all customization sync data").addButton((button) =>
            button
                .setButtonText("Delete")
                .setDisabled(false)
                .setWarning()
                .onClick(async () => {
                    Logger(`Deleting customization sync data`, LOG_LEVEL_NOTICE);
                    const entriesToDelete = await this.plugin.localDatabase.allDocsRaw({
                        startkey: "ix:",
                        endkey: "ix:\u{10ffff}",
                        include_docs: true,
                    });
                    const newData = entriesToDelete.rows.map((e) => ({
                        ...e.doc,
                        _deleted: true,
                    }));
                    const r = await this.plugin.localDatabase.bulkDocsRaw(newData as any[]);
                    // Do not care about the result.
                    Logger(
                        `${r.length} items have been removed, to confirm how many items are left, please perform it again.`,
                        LOG_LEVEL_NOTICE
                    );
                })
        );
    });
}
