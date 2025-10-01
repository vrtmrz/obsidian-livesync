import { $msg } from "@/lib/src/common/i18n";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { PageFunctions } from "./SettingPane";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { EVENT_REQUEST_RUN_DOCTOR, EVENT_REQUEST_RUN_FIX_INCOMPLETE, eventHub } from "@/common/events";
import { getPath, requestToCouchDBWithCredentials } from "@/common/utils.ts";
import { REMOTE_COUCHDB, REMOTE_MINIO, DEFAULT_SETTINGS, ObsidianLiveSyncSettings, type FilePathWithPrefix, type FilePath, type LoadedEntry, type MetaEntry } from "@/lib/src/common/types.ts";
import { createBlob, getFileRegExp, isDocContentSame, parseHeaderValues, readAsBlob } from "@/lib/src/common/utils.ts";
import { isCloudantURI } from "@/lib/src/pouchdb/utils_couchdb.ts";
import { generateCredentialObject } from "@/lib/src/replication/httplib.ts";
import { stringifyYaml } from "obsidian";
import { Logger, LOG_LEVEL_VERBOSE, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { EVENT_REQUEST_SHOW_HISTORY } from "@/common/obsidianEvents.ts";
import { ICXHeader, PSCHeader, ICHeader } from "@/common/types.ts";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync.ts";
import { stripAllPrefixes, shouldBeIgnored, addPrefix } from "@/lib/src/string_and_binary/path.ts";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore_v2";

export function pageMaintenance(
    this: ObsidianLiveSyncSettingTab,
    pageEl: HTMLElement,
    { addPanel } : PageFunctions
) : void {
    // Troubleshooting
    void addPanel(pageEl, $msg('maintenanceAndRecovery.troubleshooting.title')).then((pageEl) => {
        // Settings Doctor
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.troubleshooting.settingsDoctor.title"))
            .setDesc($msg("maintenanceAndRecovery.troubleshooting.settingsDoctor.desc"))
            .addButton((button) => 
                button
                    .setButtonText($msg("action.button.run"))
                    .setCta()
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_RUN_DOCTOR, "you wanted(Thank you)!");
                    })
            );

        // Scan for Broken Files
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.troubleshooting.scanBrokenFiles.title"))
            .setDesc($msg("maintenanceAndRecovery.troubleshooting.scanBrokenFiles.desc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("action.button.scan"))
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_RUN_FIX_INCOMPLETE);
                    })
            );

        // Prepare Report
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.troubleshooting.prepareReport.title"))
            .setDesc($msg("maintenanceAndRecovery.troubleshooting.prepareReport.desc"))
            .addButton((button) =>
                        button
                            .setButtonText($msg("action.button.copy"))
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
                                    fileSystem: this.plugin.$$isStorageInsensitive() ? "insensitive" : "sensitive",
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
                                await navigator.clipboard.writeText(msgConfig);
                                Logger(
                                    `Generated report has been copied to clipboard. Please report the issue with this! Thank you for your cooperation!`,
                                    LOG_LEVEL_NOTICE
                                );
                            })
                    );
            

        // Write Logs to File
        new Setting(pageEl)
            .autoWireToggle("writeLogToTheFile")
            .setName($msg("maintenanceAndRecovery.troubleshooting.writeLogToFile.title"))
            .setDesc($msg("maintenanceAndRecovery.troubleshooting.writeLogToFile.desc"));

        // Suspend File Watching
        new Setting(pageEl)
            .autoWireToggle("suspendFileWatching")
            .setName($msg("maintenanceAndRecovery.troubleshooting.suspendFileWatch.title"))
            .setDesc($msg("maintenanceAndRecovery.troubleshooting.suspendFileWatch.desc"));
        this.addOnSaved("suspendFileWatching", () => this.plugin.$$askReload());

        // Suspend File Replication
        new Setting(pageEl)
            .autoWireToggle("suspendParseReplicationResult")
            .setName($msg("maintenanceAndRecovery.troubleshooting.suspendDatabaseReflecting.title"))
            .setDesc($msg("maintenanceAndRecovery.troubleshooting.suspendDatabaseReflecting.desc"));
        this.addOnSaved("suspendParseReplicationResult", () => this.plugin.$$askReload());

    });

    // Recovery & Repair
    void addPanel(pageEl, $msg('maintenanceAndRecovery.recoveryAndRepair.title')).then((pageEl) => {
        // Resolve Conflicts
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.recoveryAndRepair.resolveConflictsByNewest.title"))
            .setDesc($msg("maintenanceAndRecovery.recoveryAndRepair.resolveConflictsByNewest.desc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("action.button.fix"))
                    .setCta()
                    .onClick(async () => {
                        await this.plugin.rebuilder.resolveAllConflictedFilesByNewerOnes();
                    })
            );

        // Verify and Repair Files
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.recoveryAndRepair.verifyAndRepairFiles.title"))
            .setDesc($msg("maintenanceAndRecovery.recoveryAndRepair.verifyAndRepairFiles.desc"))
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
                                        const path = getPath(i);
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
                                            if (!(await this.plugin.$$isTargetFile(path))) return incProc();
                                            const releaser = await semaphore.acquire(1);
                                            if (fileOnStorage && this.plugin.$$isFileSizeExceeded(fileOnStorage.size))
                                                return incProc();
                                            try {
                                                const isHiddenFile = path.startsWith(".");
                                                const dbPath = isHiddenFile ? addPrefix(path, ICHeader) : path;
                                                const fileOnDB = await this.plugin.localDatabase.getDBEntry(dbPath);
                                                if (fileOnDB && this.plugin.$$isFileSizeExceeded(fileOnDB.size)) return incProc();
            
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

        // Fix Path Obfuscation
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.recoveryAndRepair.fixPathObfuscation.title"))
            .setDesc($msg("maintenanceAndRecovery.recoveryAndRepair.fixPathObfuscation.desc"));

        // Recreate Missing Chunks
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.recoveryAndRepair.recreateMissingChunks.title"))
            .setDesc($msg("maintenanceAndRecovery.recoveryAndRepair.recreateMissingChunks.desc"));

        const resultArea = pageEl.createDiv({ text: "" });
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
    });

    // Garbage Collection
    void addPanel(pageEl, $msg('maintenanceAndRecovery.garbageCollection.title')).then((pageEl) => {
        // Scan Unused Chunks
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.garbageCollection.scanUnusedChunks.title"))
            .setDesc($msg("maintenanceAndRecovery.garbageCollection.scanUnusedChunks.desc"));

        // Rescue Unsynced Chunks
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.garbageCollection.restoreChunks.title"))
            .setDesc($msg("maintenanceAndRecovery.garbageCollection.restoreChunks.desc"));

        // Delete Unused Chunks
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.garbageCollection.deleteUnusedChunks.title"))
            .setDesc($msg("maintenanceAndRecovery.garbageCollection.deleteUnusedChunks.desc"));

        // Delete Orphanced Chunks
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.garbageCollection.deleteOrphanedChunks.title"))
            .setDesc($msg("maintenanceAndRecovery.garbageCollection.deleteOrphanedChunks.desc"));

        // Delete Files
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.garbageCollection.deleteFiles.title"))
            .setDesc($msg("maintenanceAndRecovery.garbageCollection.deleteFiles.desc"));

    });

    // Reset / Rebuild
    void addPanel(pageEl, $msg('maintenanceAndRecovery.resetAndRebuild.title')).then((pageEl) => {
        // Fetch from Remote (Retain Local Chunks)
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.resetAndRebuild.fetchRemoteLocalChunks.title"))
            .setDesc($msg("maintenanceAndRecovery.resetAndRebuild.fetchRemoteLocalChunks.desc"));

        // Fetch from Remote
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.resetAndRebuild.fetchRemote.title"))
            .setDesc($msg("maintenanceAndRecovery.resetAndRebuild.fetchRemote.desc"));

        // Rebuild Everything
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.resetAndRebuild.rebuildEverything.title"))
            .setDesc($msg("maintenanceAndRecovery.resetAndRebuild.rebuildEverything.desc"));

        // Perform Cleanup
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.resetAndRebuild.performCleanup.title"))
            .setDesc($msg("maintenanceAndRecovery.resetAndRebuild.performCleanup.desc"));

        // Overwrite Remote Database
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.resetAndRebuild.overwriteRemote.title"))
            .setDesc($msg("maintenanceAndRecovery.resetAndRebuild.overwriteRemote.desc"));

        // Delete Local Database
        new Setting(pageEl)
            .setName($msg("maintenanceAndRecovery.resetAndRebuild.deleteLocal.title"))
            .setDesc($msg("maintenanceAndRecovery.resetAndRebuild.deleteLocal.desc"));
    });
    
};