import { App, PluginSettingTab, Setting, sanitizeHTMLToDom, RequestUrlParam, requestUrl, TextAreaComponent, MarkdownRenderer, stringifyYaml } from "obsidian";
import { DEFAULT_SETTINGS, LOG_LEVEL, ObsidianLiveSyncSettings, ConfigPassphraseStore, RemoteDBSettings } from "./lib/src/types";
import { path2id, id2path } from "./utils";
import { delay } from "./lib/src/utils";
import { Semaphore } from "./lib/src/semaphore";
import { versionNumberString2Number } from "./lib/src/strbin";
import { Logger } from "./lib/src/logger";
import { checkSyncInfo, isCloudantURI } from "./lib/src/utils_couchdb.js";
import { testCrypt } from "./lib/src/e2ee_v2";
import ObsidianLiveSyncPlugin from "./main";
import { createPatternSetSetting, Pattern, PatternSetSetting } from "./PatternSet";

const requestToCouchDB = async (baseUri: string, username: string, password: string, origin: string, key?: string, body?: string) => {
    const utf8str = String.fromCharCode.apply(null, new TextEncoder().encode(`${username}:${password}`));
    const encoded = window.btoa(utf8str);
    const authHeader = "Basic " + encoded;
    // const origin = "capacitor://localhost";
    const transformedHeaders: Record<string, string> = { authorization: authHeader, origin: origin };
    const uri = `${baseUri}/_node/_local/_config${key ? "/" + key : ""}`;

    const requestParam: RequestUrlParam = {
        url: uri,
        method: body ? "PUT" : "GET",
        headers: transformedHeaders,
        contentType: "application/json",
        body: body ? JSON.stringify(body) : undefined,
    };
    return await requestUrl(requestParam);
};
export class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    async testConnection(): Promise<void> {
        const db = await this.plugin.localDatabase.connectRemoteCouchDBWithSetting(this.plugin.settings, this.plugin.localDatabase.isMobile);
        if (typeof db === "string") {
            this.plugin.addLog(`could not connect to ${this.plugin.settings.couchDB_URI} : ${this.plugin.settings.couchDB_DBNAME} \n(${db})`, LOG_LEVEL.NOTICE);
            return;
        }
        this.plugin.addLog(`Connected to ${db.info.db_name}`, LOG_LEVEL.NOTICE);
    }
    display(): void {
        const { containerEl } = this;
        let encrypt = this.plugin.settings.encrypt;
        let passphrase = this.plugin.settings.passphrase;
        let useDynamicIterationCount = this.plugin.settings.useDynamicIterationCount;

        containerEl.empty();

        containerEl.createEl("h2", { text: "Settings for Self-hosted LiveSync." });
        containerEl.addClass("sls-setting");
        containerEl.removeClass("isWizard");


        const w = containerEl.createDiv("");
        const screenElements: { [key: string]: HTMLElement[] } = {};
        const addScreenElement = (key: string, element: HTMLElement) => {
            if (!(key in screenElements)) {
                screenElements[key] = [];
            }
            screenElements[key].push(element);
        };
        w.addClass("sls-setting-menu");
        w.innerHTML = `
<label class='sls-setting-label c-100 wizardHidden'><input type='radio' name='disp' value='100' class='sls-setting-tab'><div class='sls-setting-menu-btn'>💬</div></label>
<label class='sls-setting-label c-110'><input type='radio' name='disp' value='110' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🪄</div></label>
<label class='sls-setting-label c-0'><input type='radio' name='disp' value='0' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🛰️</div></label>

<label class='sls-setting-label c-10'><input type='radio' name='disp' value='10' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>📦</div></label>
<label class='sls-setting-label c-20 wizardHidden'><input type='radio' name='disp' value='20' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>⚙️</div></label>
<label class='sls-setting-label c-30 wizardHidden'><input type='radio' name='disp' value='30' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🔁</div></label>
<label class='sls-setting-label c-40'><input type='radio' name='disp' value='40' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🔧</div></label>
<label class='sls-setting-label c-50 wizardHidden'><input type='radio' name='disp' value='50' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🧰</div></label>
<label class='sls-setting-label c-60 wizardHidden'><input type='radio' name='disp' value='60' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🔌</div></label>
<label class='sls-setting-label c-70 wizardHidden'><input type='radio' name='disp' value='70' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🚑</div></label>
        `;
        const menuTabs = w.querySelectorAll(".sls-setting-label");
        const changeDisplay = (screen: string) => {
            for (const k in screenElements) {
                if (k == screen) {
                    screenElements[k].forEach((element) => element.removeClass("setting-collapsed"));
                } else {
                    screenElements[k].forEach((element) => element.addClass("setting-collapsed"));
                }
            }
            w.querySelectorAll(`.sls-setting-label`).forEach((element) => {
                element.removeClass("selected");
                (element.querySelector("input[type=radio]") as HTMLInputElement).checked = false;
            });
            w.querySelectorAll(`.sls-setting-label.c-${screen}`).forEach((element) => {
                element.addClass("selected");
                (element.querySelector("input[type=radio]") as HTMLInputElement).checked = true;
            });
        };
        menuTabs.forEach((element) => {
            const e = element.querySelector(".sls-setting-tab");
            if (!e) return;
            e.addEventListener("change", (event) => {
                menuTabs.forEach((element) => element.removeClass("selected"));
                changeDisplay((event.currentTarget as HTMLInputElement).value);
                element.addClass("selected");
            });
        });

        const containerInformationEl = containerEl.createDiv();
        const h3El = containerInformationEl.createEl("h3", { text: "Updates" });
        const informationDivEl = containerInformationEl.createEl("div", { text: "" });

        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "-";
        //@ts-ignore
        const updateInformation: string = UPDATE_INFO || "";

        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);

        const tmpDiv = createSpan();
        tmpDiv.addClass("sls-header-button");
        tmpDiv.innerHTML = `<button> OK, I read all. </button>`;
        if (lastVersion > this.plugin.settings.lastReadUpdates) {
            const informationButtonDiv = h3El.appendChild(tmpDiv);
            informationButtonDiv.querySelector("button").addEventListener("click", async () => {
                this.plugin.settings.lastReadUpdates = lastVersion;
                await this.plugin.saveSettings();
                informationButtonDiv.remove();
            });

        }

        MarkdownRenderer.renderMarkdown(updateInformation, informationDivEl, "/", null);


        addScreenElement("100", containerInformationEl);
        const isAnySyncEnabled = (): boolean => {
            if (this.plugin.settings.liveSync) return true;
            if (this.plugin.settings.periodicReplication) return true;
            if (this.plugin.settings.syncOnFileOpen) return true;
            if (this.plugin.settings.syncOnSave) return true;
            if (this.plugin.settings.syncOnStart) return true;
            if (this.plugin.settings.syncAfterMerge) return true;
            if (this.plugin.localDatabase.syncStatus == "CONNECTED") return true;
            if (this.plugin.localDatabase.syncStatus == "PAUSED") return true;
            return false;
        };
        let inWizard = false;

        const setupWizardEl = containerEl.createDiv();
        setupWizardEl.createEl("h3", { text: "Setup wizard" });
        new Setting(setupWizardEl)
            .setName("Discard the existing configuration and set up")
            .addButton((text) => {
                text.setButtonText("Next").onClick(() => {
                    if (JSON.stringify(this.plugin.settings) != JSON.stringify(DEFAULT_SETTINGS)) {
                        this.plugin.localDatabase.closeReplication();
                        this.plugin.settings = { ...DEFAULT_SETTINGS };
                        this.plugin.saveSettings();

                        Logger("Configuration has been flushed, please open it again", LOG_LEVEL.NOTICE)
                        // @ts-ignore
                        this.plugin.app.setting.close()
                    } else {
                        containerEl.addClass("isWizard");
                        applyDisplayEnabled();
                        inWizard = true;
                        changeDisplay("0")
                    }
                })
            })
        new Setting(setupWizardEl)
            .setName("Do not discard the existing configuration and set up again")
            .addButton((text) => {
                text.setButtonText("Next").onClick(async () => {
                    this.plugin.settings.liveSync = false;
                    this.plugin.settings.periodicReplication = false;
                    this.plugin.settings.syncOnSave = false;
                    this.plugin.settings.syncOnStart = false;
                    this.plugin.settings.syncOnFileOpen = false;
                    this.plugin.settings.syncAfterMerge = false;
                    this.plugin.localDatabase.closeReplication();
                    await this.plugin.saveSettings();
                    containerEl.addClass("isWizard");
                    applyDisplayEnabled();
                    inWizard = true;
                    changeDisplay("0")

                })
            })
        const infoWarnForSubsequent = setupWizardEl.createEl("div", { text: `To set up second or subsequent device, please use  'Copy setup URI' and 'Open setup URI'` });
        infoWarnForSubsequent.addClass("op-warn-info");
        new Setting(setupWizardEl)
            .setName("Copy setup URI")
            .addButton((text) => {
                text.setButtonText("Copy setup URI").onClick(() => {
                    // @ts-ignore
                    this.plugin.app.commands.executeCommandById("obsidian-livesync:livesync-copysetupuri")

                })
            })
            .addButton((text) => {
                text.setButtonText("Open setup URI").onClick(() => {
                    // @ts-ignore
                    this.plugin.app.commands.executeCommandById("obsidian-livesync:livesync-opensetupuri")

                })
            })

        addScreenElement("110", setupWizardEl);

        const containerRemoteDatabaseEl = containerEl.createDiv();
        containerRemoteDatabaseEl.createEl("h3", { text: "Remote Database configuration" });
        const syncWarn = containerRemoteDatabaseEl.createEl("div", { text: `These settings are kept locked while any synchronization options are enabled. Disable these options in the "Sync Settings" tab to unlock.` });
        syncWarn.addClass("op-warn-info");
        syncWarn.addClass("sls-hidden");


        const applyDisplayEnabled = () => {
            if (isAnySyncEnabled()) {
                dbSettings.forEach((e) => {
                    e.setDisabled(true).setTooltip("Could not change this while any synchronization options are enabled.");
                });
                syncWarn.removeClass("sls-hidden");
            } else {
                dbSettings.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
                syncWarn.addClass("sls-hidden");
            }
            if (this.plugin.settings.liveSync) {
                syncNonLive.forEach((e) => {
                    e.setDisabled(true).setTooltip("");
                });
                syncLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
            } else if (this.plugin.settings.syncOnFileOpen || this.plugin.settings.syncOnSave || this.plugin.settings.syncOnStart || this.plugin.settings.periodicReplication || this.plugin.settings.syncAfterMerge) {
                syncNonLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
                syncLive.forEach((e) => {
                    e.setDisabled(true).setTooltip("");
                });
            } else {
                syncNonLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
                syncLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
            }
        };

        const dbSettings: Setting[] = [];
        dbSettings.push(
            new Setting(containerRemoteDatabaseEl).setName("URI").addText((text) =>
                text
                    .setPlaceholder("https://........")
                    .setValue(this.plugin.settings.couchDB_URI)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_URI = value;
                        await this.plugin.saveSettings();
                    })
            ),
            new Setting(containerRemoteDatabaseEl)
                .setName("Username")
                .setDesc("username")
                .addText((text) =>
                    text
                        .setPlaceholder("")
                        .setValue(this.plugin.settings.couchDB_USER)
                        .onChange(async (value) => {
                            this.plugin.settings.couchDB_USER = value;
                            await this.plugin.saveSettings();
                        })
                ),
            new Setting(containerRemoteDatabaseEl)
                .setName("Password")
                .setDesc("password")
                .addText((text) => {
                    text.setPlaceholder("")
                        .setValue(this.plugin.settings.couchDB_PASSWORD)
                        .onChange(async (value) => {
                            this.plugin.settings.couchDB_PASSWORD = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.setAttribute("type", "password");
                }),
            new Setting(containerRemoteDatabaseEl).setName("Database name").addText((text) =>
                text
                    .setPlaceholder("")
                    .setValue(this.plugin.settings.couchDB_DBNAME)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_DBNAME = value;
                        await this.plugin.saveSettings();
                    })
            )

        );
        const e2e = new Setting(containerRemoteDatabaseEl)
            .setName("End to End Encryption")
            .setDesc("Encrypt contents on the remote database. If you use the plugin's synchronization feature, enabling this is recommend.")
            .addToggle((toggle) =>
                toggle.setValue(encrypt).onChange(async (value) => {
                    if (inWizard) {
                        this.plugin.settings.encrypt = value;
                        passphraseSetting.setDisabled(!value);
                        dynamicIteration.setDisabled(!value);
                        await this.plugin.saveSettings();
                    } else {
                        encrypt = value;
                        passphraseSetting.setDisabled(!value);
                        dynamicIteration.setDisabled(!value);
                        await this.plugin.saveSettings();
                        markDirtyControl();
                    }
                })
            );


        const markDirtyControl = () => {
            passphraseSetting.controlEl.toggleClass("sls-item-dirty", passphrase != this.plugin.settings.passphrase);
            e2e.controlEl.toggleClass("sls-item-dirty", encrypt != this.plugin.settings.encrypt);
            dynamicIteration.controlEl.toggleClass("sls-item-dirty", useDynamicIterationCount != this.plugin.settings.useDynamicIterationCount)
        }

        const passphraseSetting = new Setting(containerRemoteDatabaseEl)
            .setName("Passphrase")
            .setDesc("Encrypting passphrase. If you change the passphrase of a existing database, overwriting the remote database is strongly recommended.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(passphrase)
                    .onChange(async (value) => {
                        if (inWizard) {
                            this.plugin.settings.passphrase = value;
                            await this.plugin.saveSettings();
                        } else {
                            passphrase = value;
                            await this.plugin.saveSettings();
                            markDirtyControl();
                        }
                    });
                text.inputEl.setAttribute("type", "password");
            });
        passphraseSetting.setDisabled(!encrypt);

        const dynamicIteration = new Setting(containerRemoteDatabaseEl)
            .setName("Use dynamic iteration count (experimental)")
            .setDesc("Balancing the encryption/decryption load against the length of the passphrase if toggled. (v0.17.5 or higher required)")
            .addToggle((toggle) => {
                toggle.setValue(useDynamicIterationCount)
                    .onChange(async (value) => {
                        if (inWizard) {
                            this.plugin.settings.useDynamicIterationCount = value;
                            await this.plugin.saveSettings();
                        } else {
                            useDynamicIterationCount = value;
                            await this.plugin.saveSettings();
                            markDirtyControl();
                        }
                    });
            })
            .setClass("wizardHidden");
        dynamicIteration.setDisabled(!encrypt);

        const checkWorkingPassphrase = async (): Promise<boolean> => {
            const settingForCheck: RemoteDBSettings = {
                ...this.plugin.settings,
                encrypt: encrypt,
                passphrase: passphrase,
                useDynamicIterationCount: useDynamicIterationCount,
            };
            console.dir(settingForCheck);
            const db = await this.plugin.localDatabase.connectRemoteCouchDBWithSetting(settingForCheck, this.plugin.localDatabase.isMobile);
            if (typeof db === "string") {
                Logger("Could not connect to the database.", LOG_LEVEL.NOTICE);
                return false;
            } else {
                if (await checkSyncInfo(db.db)) {
                    // Logger("Database connected", LOG_LEVEL.NOTICE);
                    return true;
                } else {
                    Logger("Failed to read remote database", LOG_LEVEL.NOTICE);
                    return false;
                }
            }
        };
        const applyEncryption = async (sendToServer: boolean) => {
            if (encrypt && passphrase == "") {
                Logger("If you enable encryption, you have to set the passphrase", LOG_LEVEL.NOTICE);
                return;
            }
            if (encrypt && !(await testCrypt())) {
                Logger("WARNING! Your device would not support encryption.", LOG_LEVEL.NOTICE);
                return;
            }
            if (!(await checkWorkingPassphrase()) && !sendToServer) {
                return;
            }
            if (!encrypt) {
                passphrase = "";
            }
            this.plugin.settings.liveSync = false;
            this.plugin.settings.periodicReplication = false;
            this.plugin.settings.syncOnSave = false;
            this.plugin.settings.syncOnStart = false;
            this.plugin.settings.syncOnFileOpen = false;
            this.plugin.settings.syncAfterMerge = false;
            this.plugin.settings.encrypt = encrypt;
            this.plugin.settings.passphrase = passphrase;
            this.plugin.settings.useDynamicIterationCount = useDynamicIterationCount;

            await this.plugin.saveSettings();
            markDirtyControl();
            if (sendToServer) {
                await this.plugin.initializeDatabase(true);
                await this.plugin.markRemoteLocked();
                await this.plugin.tryResetRemoteDatabase();
                await this.plugin.markRemoteLocked();
                await this.plugin.replicateAllToServer(true);
            } else {
                await this.plugin.markRemoteResolved();
                await this.plugin.replicate(true);
            }
        };
        new Setting(containerRemoteDatabaseEl)
            .setName("Apply")
            .setDesc("Apply encryption settings")
            .setClass("wizardHidden")
            .addButton((button) =>
                button
                    .setButtonText("Apply")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await applyEncryption(true);
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply w/o rebuilding")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await applyEncryption(false);
                    })
            );


        const rebuildDB = async (method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice") => {
            this.plugin.settings.liveSync = false;
            this.plugin.settings.periodicReplication = false;
            this.plugin.settings.syncOnSave = false;
            this.plugin.settings.syncOnStart = false;
            this.plugin.settings.syncOnFileOpen = false;
            this.plugin.settings.syncAfterMerge = false;
            await this.plugin.saveSettings();

            applyDisplayEnabled();
            await delay(2000);
            if (method == "localOnly") {
                await this.plugin.resetLocalDatabase();
                await this.plugin.markRemoteResolved();
                await this.plugin.replicate(true);
            }
            if (method == "remoteOnly") {
                await this.plugin.markRemoteLocked();
                await this.plugin.tryResetRemoteDatabase();
                await this.plugin.markRemoteLocked();
                await this.plugin.replicateAllToServer(true);
            }
            if (method == "rebuildBothByThisDevice") {
                await this.plugin.resetLocalDatabase();
                await this.plugin.initializeDatabase(true);
                await this.plugin.markRemoteLocked();
                await this.plugin.tryResetRemoteDatabase();
                await this.plugin.markRemoteLocked();
                await this.plugin.replicateAllToServer(true);
            }
        }

        new Setting(containerRemoteDatabaseEl)
            .setName("Overwrite remote database")
            .setDesc("Overwrite remote database with local DB and passphrase.")
            .setClass("wizardHidden")
            .addButton((button) =>
                button
                    .setButtonText("Send")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("remoteOnly");
                    })
            )

        new Setting(containerRemoteDatabaseEl)
            .setName("Rebuild everything")
            .setDesc("Rebuild local and remote database with local files.")
            .setClass("wizardHidden")
            .addButton((button) =>
                button
                    .setButtonText("Rebuild")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("rebuildBothByThisDevice");
                    })
            )

        new Setting(containerRemoteDatabaseEl)
            .setName("Test Database Connection")
            .setDesc("Open database connection. If the remote database is not found and you have the privilege to create a database, the database will be created.")
            .addButton((button) =>
                button
                    .setButtonText("Test")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.testConnection();
                    })
            );

        new Setting(containerRemoteDatabaseEl)
            .setName("Check database configuration")
            // .setDesc("Open database connection. If the remote database is not found and you have the privilege to create a database, the database will be created.")
            .addButton((button) =>
                button
                    .setButtonText("Check")
                    .setDisabled(false)
                    .onClick(async () => {
                        const checkConfig = async () => {
                            try {
                                if (isCloudantURI(this.plugin.settings.couchDB_URI)) {
                                    Logger("This feature cannot be used with IBM Cloudant.", LOG_LEVEL.NOTICE);
                                    return;
                                }

                                const r = await requestToCouchDB(this.plugin.settings.couchDB_URI, this.plugin.settings.couchDB_USER, this.plugin.settings.couchDB_PASSWORD, window.origin);

                                Logger(JSON.stringify(r.json, null, 2));

                                const responseConfig = r.json;

                                const emptyDiv = createDiv();
                                emptyDiv.innerHTML = "<span></span>";
                                checkResultDiv.replaceChildren(...[emptyDiv]);
                                const addResult = (msg: string, classes?: string[]) => {
                                    const tmpDiv = createDiv();
                                    tmpDiv.addClass("ob-btn-config-fix");
                                    if (classes) {
                                        tmpDiv.addClasses(classes);
                                    }
                                    tmpDiv.innerHTML = `${msg}`;
                                    checkResultDiv.appendChild(tmpDiv);
                                };
                                const addConfigFixButton = (title: string, key: string, value: string) => {
                                    const tmpDiv = createDiv();
                                    tmpDiv.addClass("ob-btn-config-fix");
                                    tmpDiv.innerHTML = `<label>${title}</label><button>Fix</button>`;
                                    const x = checkResultDiv.appendChild(tmpDiv);
                                    x.querySelector("button").addEventListener("click", async () => {
                                        console.dir({ key, value });
                                        const res = await requestToCouchDB(this.plugin.settings.couchDB_URI, this.plugin.settings.couchDB_USER, this.plugin.settings.couchDB_PASSWORD, undefined, key, value);
                                        console.dir(res);
                                        if (res.status == 200) {
                                            Logger(`${title} successfully updated`, LOG_LEVEL.NOTICE);
                                            checkResultDiv.removeChild(x);
                                            checkConfig();
                                        } else {
                                            Logger(`${title} failed`, LOG_LEVEL.NOTICE);
                                            Logger(res.text);
                                        }
                                    });
                                };
                                addResult("---Notice---", ["ob-btn-config-head"]);
                                addResult(
                                    "If the server configuration is not persistent (e.g., running on docker), the values set from here will also be volatile. Once you are able to connect, please reflect the settings in the server's local.ini.",
                                    ["ob-btn-config-info"]
                                );

                                addResult("Your configuration is dumped to Log", ["ob-btn-config-info"]);
                                addResult("--Config check--", ["ob-btn-config-head"]);

                                // Admin check
                                //  for database creation and deletion
                                if (!(this.plugin.settings.couchDB_USER in responseConfig.admins)) {
                                    addResult(`⚠ You do not have administrative privileges.`);
                                } else {
                                    addResult("✔ You have administrative privileges.");
                                }
                                // HTTP user-authorization check
                                if (responseConfig?.chttpd?.require_valid_user != "true") {
                                    addResult("❗ chttpd.require_valid_user looks like wrong.");
                                    addConfigFixButton("Set chttpd.require_valid_user = true", "chttpd/require_valid_user", "true");
                                } else {
                                    addResult("✔ chttpd.require_valid_user is ok.");
                                }
                                if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                                    addResult("❗ chttpd_auth.require_valid_user looks like wrong.");
                                    addConfigFixButton("Set chttpd_auth.require_valid_user = true", "chttpd_auth/require_valid_user", "true");
                                } else {
                                    addResult("✔ chttpd_auth.require_valid_user is ok.");
                                }
                                // HTTPD check
                                //  Check Authentication header
                                if (!responseConfig?.httpd["WWW-Authenticate"]) {
                                    addResult("❗ httpd.WWW-Authenticate is missing");
                                    addConfigFixButton("Set httpd.WWW-Authenticate", "httpd/WWW-Authenticate", 'Basic realm="couchdb"');
                                } else {
                                    addResult("✔ httpd.WWW-Authenticate is ok.");
                                }
                                if (responseConfig?.httpd?.enable_cors != "true") {
                                    addResult("❗ httpd.enable_cors is wrong");
                                    addConfigFixButton("Set httpd.enable_cors", "httpd/enable_cors", "true");
                                } else {
                                    addResult("✔ httpd.enable_cors is ok.");
                                }
                                // If the server is not cloudant, configure request size
                                if (!isCloudantURI(this.plugin.settings.couchDB_URI)) {
                                    // REQUEST SIZE
                                    if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                                        addResult("❗ chttpd.max_http_request_size is low)");
                                        addConfigFixButton("Set chttpd.max_http_request_size", "chttpd/max_http_request_size", "4294967296");
                                    } else {
                                        addResult("✔ chttpd.max_http_request_size is ok.");
                                    }
                                    if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                                        addResult("❗ couchdb.max_document_size is low)");
                                        addConfigFixButton("Set couchdb.max_document_size", "couchdb/max_document_size", "50000000");
                                    } else {
                                        addResult("✔ couchdb.max_document_size is ok.");
                                    }
                                }
                                // CORS check
                                //  checking connectivity for mobile
                                if (responseConfig?.cors?.credentials != "true") {
                                    addResult("❗ cors.credentials is wrong");
                                    addConfigFixButton("Set cors.credentials", "cors/credentials", "true");
                                } else {
                                    addResult("✔ cors.credentials is ok.");
                                }
                                const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
                                if (
                                    responseConfig?.cors?.origins == "*" ||
                                    (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 && ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 && ConfiguredOrigins.indexOf("http://localhost") !== -1)
                                ) {
                                    addResult("✔ cors.origins is ok.");
                                } else {
                                    addResult("❗ cors.origins is wrong");
                                    addConfigFixButton("Set cors.origins", "cors/origins", "app://obsidian.md,capacitor://localhost,http://localhost");
                                }
                                addResult("--Connection check--", ["ob-btn-config-head"]);
                                addResult(`Current origin:${window.location.origin}`);

                                // Request header check
                                const origins = ["app://obsidian.md", "capacitor://localhost", "http://localhost"];
                                for (const org of origins) {
                                    const rr = await requestToCouchDB(this.plugin.settings.couchDB_URI, this.plugin.settings.couchDB_USER, this.plugin.settings.couchDB_PASSWORD, org);
                                    const responseHeaders = Object.entries(rr.headers)
                                        .map((e) => {
                                            e[0] = (e[0] + "").toLowerCase();
                                            return e;
                                        })
                                        .reduce((obj, [key, val]) => {
                                            obj[key] = val;
                                            return obj;
                                        }, {} as { [key: string]: string });
                                    addResult(`Origin check:${org}`);
                                    if (responseHeaders["access-control-allow-credentials"] != "true") {
                                        addResult("❗ CORS is not allowing credential");
                                    } else {
                                        addResult("✔ CORS credential OK");
                                    }
                                    if (responseHeaders["access-control-allow-origin"] != org) {
                                        addResult(`❗ CORS Origin is unmatched:${origin}->${responseHeaders["access-control-allow-origin"]}`);
                                    } else {
                                        addResult("✔ CORS origin OK");
                                    }
                                }
                                addResult("--Done--", ["ob-btn-config-head"]);
                                addResult("If you have some trouble with Connection-check even though all Config-check has been passed, Please check your reverse proxy's configuration.", ["ob-btn-config-info"]);
                            } catch (ex) {
                                Logger(`Checking configuration failed`, LOG_LEVEL.NOTICE);
                                Logger(ex);
                            }
                        };
                        await checkConfig();
                    })
            );
        const checkResultDiv = containerRemoteDatabaseEl.createEl("div", {
            text: "",
        });

        new Setting(containerRemoteDatabaseEl)
            .setName("Lock remote database")
            .setDesc("Lock remote database to prevent synchronization with other devices.")
            .setClass("wizardHidden")
            .addButton((button) =>
                button
                    .setButtonText("Lock")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.markRemoteLocked();
                    })
            );
        let rebuildRemote = false;

        new Setting(containerRemoteDatabaseEl)
            .setName("")
            .setClass("wizardOnly")
            .addButton((button) =>
                button
                    .setButtonText("Next")
                    .setClass("mod-cta")
                    .setDisabled(false)
                    .onClick(() => {
                        if (!this.plugin.settings.encrypt) {
                            this.plugin.settings.passphrase = "";
                        }
                        if (isCloudantURI(this.plugin.settings.couchDB_URI)) {
                            this.plugin.settings.customChunkSize = 0;
                        } else {
                            this.plugin.settings.customChunkSize = 100;
                        }
                        rebuildRemote = false;
                        changeDisplay("10")
                    })
            );
        new Setting(containerRemoteDatabaseEl)
            .setName("")
            .setClass("wizardOnly")
            .addButton((button) =>
                button
                    .setButtonText("Discard exist database and proceed")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(() => {
                        if (!this.plugin.settings.encrypt) {
                            this.plugin.settings.passphrase = "";
                        }
                        if (isCloudantURI(this.plugin.settings.couchDB_URI)) {
                            this.plugin.settings.customChunkSize = 0;
                        } else {
                            this.plugin.settings.customChunkSize = 100;
                        }
                        rebuildRemote = true;
                        changeDisplay("10")
                    })
            );
        addScreenElement("0", containerRemoteDatabaseEl);
        const containerLocalDatabaseEl = containerEl.createDiv();
        containerLocalDatabaseEl.createEl("h3", { text: "Local Database configuration" });

        new Setting(containerLocalDatabaseEl)
            .setName("Batch database update")
            .setDesc("Delay all changes, save once before replication or opening another file.")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.batchSave).onChange(async (value) => {
                    if (value && this.plugin.settings.liveSync) {
                        Logger("LiveSync and Batch database update cannot be used at the same time.", LOG_LEVEL.NOTICE);
                        toggle.setValue(false);
                        return;
                    }
                    this.plugin.settings.batchSave = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerLocalDatabaseEl)
            .setName("Fetch rebuilt DB")
            .setDesc("Restore or reconstruct local database from remote database.")
            .setClass("wizardHidden")
            .addButton((button) =>
                button
                    .setButtonText("Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("localOnly");
                    })
            )


        let newDatabaseName = this.plugin.settings.additionalSuffixOfDatabaseName + "";
        new Setting(containerLocalDatabaseEl)
            .setName("Database suffix")
            .setDesc("Optional: Set unique name for using same vault name on different directory.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(newDatabaseName)
                    .onChange((value) => {
                        newDatabaseName = value;

                    });
            }).addButton((button) => {
                button.setButtonText("Change")
                    .onClick(async () => {
                        if (this.plugin.settings.additionalSuffixOfDatabaseName == newDatabaseName) {
                            Logger("Suffix was not changed.", LOG_LEVEL.NOTICE);
                            return;
                        }
                        this.plugin.settings.additionalSuffixOfDatabaseName = newDatabaseName;
                        await this.plugin.saveSettings();
                        Logger("Suffix has been changed. Reopening database...", LOG_LEVEL.NOTICE);
                        await this.plugin.initializeDatabase();
                    })
            })
        new Setting(containerLocalDatabaseEl)
            .setName("")
            .setClass("wizardOnly")
            .addButton((button) =>
                button
                    .setButtonText("Next")
                    .setDisabled(false)
                    .onClick(() => {
                        changeDisplay("40");
                    })
            );

        containerLocalDatabaseEl.createEl("h3", {
            text: sanitizeHTMLToDom(`Experimental`),
            cls: "wizardHidden"
        });

        new Setting(containerLocalDatabaseEl)
            .setName("Use new adapter")
            .setDesc("This option is not compatible with a database made by older versions. Changing this configuration will fetch the remote database again.")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.useIndexedDBAdapter).onChange(async (value) => {
                    this.plugin.settings.useIndexedDBAdapter = value;
                    await this.plugin.saveSettings();
                    await rebuildDB("localOnly");
                })
            );

        addScreenElement("10", containerLocalDatabaseEl);
        const containerGeneralSettingsEl = containerEl.createDiv();
        containerGeneralSettingsEl.createEl("h3", { text: "General Settings" });

        new Setting(containerGeneralSettingsEl)
            .setName("Do not show low-priority Log")
            .setDesc("Reduce log information")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.lessInformationInLog).onChange(async (value) => {
                    this.plugin.settings.lessInformationInLog = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerGeneralSettingsEl)
            .setName("Verbose Log")
            .setDesc("Show verbose log")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showVerboseLog).onChange(async (value) => {
                    this.plugin.settings.showVerboseLog = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerGeneralSettingsEl)
            .setName("Delete metadata of deleted files.")
            .setClass("wizardHidden")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.deleteMetadataOfDeletedFiles).onChange(async (value) => {
                    this.plugin.settings.deleteMetadataOfDeletedFiles = value;
                    await this.plugin.saveSettings();
                })
            }
            );
        new Setting(containerGeneralSettingsEl)
            .setName("Delete old metadata of deleted files on start-up")
            .setClass("wizardHidden")
            .setDesc("(Days passed, 0 to disable automatic-deletion)")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.automaticallyDeleteMetadataOfDeletedFiles + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v)) {
                            v = 0;
                        }
                        this.plugin.settings.automaticallyDeleteMetadataOfDeletedFiles = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });
        new Setting(containerGeneralSettingsEl)
            .setName("Monitor changes to hidden files and plugin")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.watchInternalFileChanges).onChange(async (value) => {
                    this.plugin.settings.watchInternalFileChanges = value;
                    await this.plugin.saveSettings();
                })
            );


        addScreenElement("20", containerGeneralSettingsEl);
        const containerSyncSettingEl = containerEl.createDiv();
        containerSyncSettingEl.createEl("h3", { text: "Sync Settings" });
        containerSyncSettingEl.addClass("wizardHidden")

        if (this.plugin.settings.versionUpFlash != "") {
            const c = containerSyncSettingEl.createEl("div", { text: this.plugin.settings.versionUpFlash });
            c.createEl("button", { text: "I got it and updated." }, (e) => {
                e.addClass("mod-cta");
                e.addEventListener("click", async () => {
                    this.plugin.settings.versionUpFlash = "";
                    await this.plugin.saveSettings();
                    applyDisplayEnabled();
                    c.remove();
                });
            });
            c.addClass("op-warn");
        }

        const syncLive: Setting[] = [];
        const syncNonLive: Setting[] = [];
        syncLive.push(
            new Setting(containerSyncSettingEl)
                .setName("LiveSync")
                .setDesc("Sync realtime")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.liveSync).onChange(async (value) => {
                        if (value && this.plugin.settings.batchSave) {
                            Logger("LiveSync and Batch database update cannot be used at the same time.", LOG_LEVEL.NOTICE);
                            toggle.setValue(false);
                            return;
                        }

                        this.plugin.settings.liveSync = value;
                        // ps.setDisabled(value);
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                        await this.plugin.realizeSettingSyncMode();
                    })
                )
        );

        syncNonLive.push(
            new Setting(containerSyncSettingEl)
                .setName("Periodic Sync")
                .setDesc("Sync periodically")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.periodicReplication).onChange(async (value) => {
                        this.plugin.settings.periodicReplication = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
            new Setting(containerSyncSettingEl)
                .setName("Periodic Sync interval")
                .setDesc("Interval (sec)")
                .addText((text) => {
                    text.setPlaceholder("")
                        .setValue(this.plugin.settings.periodicReplicationInterval + "")
                        .onChange(async (value) => {
                            let v = Number(value);
                            if (isNaN(v) || v > 5000) {
                                v = 0;
                            }
                            this.plugin.settings.periodicReplicationInterval = v;
                            await this.plugin.saveSettings();
                            applyDisplayEnabled();
                        });
                    text.inputEl.setAttribute("type", "number");
                }),

            new Setting(containerSyncSettingEl)
                .setName("Sync on Save")
                .setDesc("When you save file, sync automatically")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
                        this.plugin.settings.syncOnSave = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
            new Setting(containerSyncSettingEl)
                .setName("Sync on File Open")
                .setDesc("When you open file, sync automatically")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnFileOpen).onChange(async (value) => {
                        this.plugin.settings.syncOnFileOpen = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
            new Setting(containerSyncSettingEl)
                .setName("Sync on Start")
                .setDesc("Start synchronization after launching Obsidian.")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (value) => {
                        this.plugin.settings.syncOnStart = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
            new Setting(containerSyncSettingEl)
                .setName("Sync after merging file")
                .setDesc("Sync automatically after merging files")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncAfterMerge).onChange(async (value) => {
                        this.plugin.settings.syncAfterMerge = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
        );

        new Setting(containerSyncSettingEl)
            .setName("Use Trash for deleted files")
            .setDesc("Do not delete files that are deleted in remote, just move to trash.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.trashInsteadDelete).onChange(async (value) => {
                    this.plugin.settings.trashInsteadDelete = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Do not delete empty folder")
            .setDesc("Normally, a folder is deleted when it becomes empty after a replication. Enabling this will prevent it from getting deleted")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.doNotDeleteFolder).onChange(async (value) => {
                    this.plugin.settings.doNotDeleteFolder = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Use newer file if conflicted (beta)")
            .setDesc("Resolve conflicts by newer files automatically.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.resolveConflictsByNewerFile).onChange(async (value) => {
                    this.plugin.settings.resolveConflictsByNewerFile = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Check conflict only on opened files")
            .setDesc("Do not check conflict for replication")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.checkConflictOnlyOnOpen).onChange(async (value) => {
                    this.plugin.settings.checkConflictOnlyOnOpen = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerSyncSettingEl)
            .setName("Disable sensible auto merging on markdown files")
            .setDesc("If this switch is turned on, a merge dialog will be displayed, even if the sensible-merge is possible automatically. (Turn on to previous behavior)")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.disableMarkdownAutoMerge).onChange(async (value) => {
                    this.plugin.settings.disableMarkdownAutoMerge = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerSyncSettingEl)
            .setName("Write documents after synchronization even if they have conflict")
            .setDesc("Turn on to previous behavior")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.writeDocumentsIfConflicted).onChange(async (value) => {
                    this.plugin.settings.writeDocumentsIfConflicted = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Sync hidden files")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncInternalFiles).onChange(async (value) => {
                    this.plugin.settings.syncInternalFiles = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Scan for hidden files before replication")
            .setDesc("This configuration will be ignored if monitoring changes is enabled.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncInternalFilesBeforeReplication).onChange(async (value) => {
                    this.plugin.settings.syncInternalFilesBeforeReplication = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerSyncSettingEl)
            .setName("Scan hidden files periodically")
            .setDesc("Seconds, 0 to disable. This configuration will be ignored if monitoring changes is enabled.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.syncInternalFilesInterval + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10) {
                            v = 10;
                        }
                        this.plugin.settings.syncInternalFilesInterval = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        const defaultSkipPattern = [{regex: "\\/node_modules\\/"}, {regex: "\\/\\.git\\/"}, {regex: "\\/obsidian-livesync\\/"}];
        const defaultSkipPatternXPlat = [...defaultSkipPattern, {regex: "\\/workspace$"} ,{regex: "\\/workspace.json$"}];
        let patternSetSetting: PatternSetSetting = null;
        new Setting(containerSyncSettingEl)
            .setName("Skip patterns")
            .setDesc(
                "Files that will not be synced to the database. If you use hidden file sync between desktop and mobile, adding `workspace$` is recommended."
            )
            .then(createPatternSetSetting(this.plugin.settings.syncInternalFilesIgnorePatterns as Pattern[], (component) => {
                patternSetSetting = component;
                component.onChange(async (patterns) => {
                    this.plugin.internalFilesIgnorePatterns = patterns;
                    this.plugin.settings.syncInternalFilesIgnorePatterns = patterns.entries();
                    await this.plugin.saveSettings();
                })
            }));
        new Setting(containerSyncSettingEl)
            .setName("Restore the skip pattern to default")
            .addButton((button) => {
                button.setButtonText("Default")
                    .onClick(async () => {
                        patternSetSetting.resetTo(defaultSkipPattern);
                    })
            }).addButton((button) => {
                button.setButtonText("Cross-platform")
                    .onClick(async () => {
                        patternSetSetting.resetTo(defaultSkipPatternXPlat);
                    })
            })

        new Setting(containerSyncSettingEl)
            .setName("Touch hidden files")
            .setDesc("Update the modified time of all hidden files to the current time.")
            .addButton((button) =>
                button
                    .setButtonText("Touch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        const filesAll = await this.plugin.scanInternalFiles();
                        const targetFiles = await this.plugin.filterTargetFiles(filesAll);
                        const now = Date.now();
                        const newFiles = targetFiles.map(e => ({ ...e, mtime: now }));
                        let i = 0;
                        const maxFiles = newFiles.length;
                        for (const file of newFiles) {
                            i++;
                            Logger(`Touched:${file.path} (${i}/${maxFiles})`, LOG_LEVEL.NOTICE, "touch-files");
                            await this.plugin.applyMTimeToFile(file);
                        }
                    })
            )

        containerSyncSettingEl.createEl("h3", {
            text: sanitizeHTMLToDom(`Experimental`),
        });
        new Setting(containerSyncSettingEl)
            .setName("Regular expression to ignore files")
            .setDesc("If this is set, any changes to local and remote files that match this will be skipped.")
            .addTextArea((text) => {
                text
                    .setValue(this.plugin.settings.syncIgnoreRegEx)
                    .setPlaceholder("\\.pdf$")
                    .onChange(async (value) => {
                        let isValidRegExp = false;
                        try {
                            new RegExp(value);
                            isValidRegExp = true;
                        } catch (_) {
                            // NO OP.
                        }
                        if (isValidRegExp || value.trim() == "") {
                            this.plugin.settings.syncIgnoreRegEx = value;
                            await this.plugin.saveSettings();
                        }
                    })
                return text;
            }
            );
        new Setting(containerSyncSettingEl)
            .setName("Regular expression for restricting synchronization targets")
            .setDesc("If this is set, changes to local and remote files that only match this will be processed.")
            .addTextArea((text) => {
                text
                    .setValue(this.plugin.settings.syncOnlyRegEx)
                    .setPlaceholder("\\.md$|\\.txt")
                    .onChange(async (value) => {
                        let isValidRegExp = false;
                        try {
                            new RegExp(value);
                            isValidRegExp = true;
                        } catch (_) {
                            // NO OP.
                        }
                        if (isValidRegExp || value.trim() == "") {
                            this.plugin.settings.syncOnlyRegEx = value;
                            await this.plugin.saveSettings();
                        }
                    })
                return text;
            }
            );

        new Setting(containerSyncSettingEl)
            .setName("Chunk size")
            .setDesc("Customize chunk size for binary files (0.1MBytes). This cannot be increased when using IBM Cloudant.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.customChunkSize + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 1) {
                            v = 1;
                        }
                        this.plugin.settings.customChunkSize = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        new Setting(containerSyncSettingEl)
            .setName("Read chunks online.")
            .setDesc("If this option is enabled, LiveSync reads chunks online directly instead of replicating them locally. Increasing Custom chunk size is recommended.")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.readChunksOnline)
                    .onChange(async (value) => {
                        this.plugin.settings.readChunksOnline = value;
                        await this.plugin.saveSettings();
                    })
                return toggle;
            }
            );
        containerSyncSettingEl.createEl("h3", {
            text: sanitizeHTMLToDom(`Advanced settings`),
        });
        containerSyncSettingEl.createEl("div", {
            text: `If you reached the payload size limit when using IBM Cloudant, please decrease batch size and batch limit to a lower value.`,
        });
        new Setting(containerSyncSettingEl)
            .setName("Batch size")
            .setDesc("Number of change feed items to process at a time. Defaults to 250.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.batch_size + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10) {
                            v = 10;
                        }
                        this.plugin.settings.batch_size = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        new Setting(containerSyncSettingEl)
            .setName("Batch limit")
            .setDesc("Number of batches to process at a time. Defaults to 40. This along with batch size controls how many docs are kept in memory at a time.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.batches_limit + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10) {
                            v = 10;
                        }
                        this.plugin.settings.batches_limit = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        addScreenElement("30", containerSyncSettingEl);
        const containerMiscellaneousEl = containerEl.createDiv();
        containerMiscellaneousEl.createEl("h3", { text: "Miscellaneous" });
        new Setting(containerMiscellaneousEl)
            .setName("Show status inside editor")
            .setDesc("")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showStatusOnEditor).onChange(async (value) => {
                    this.plugin.settings.showStatusOnEditor = value;
                    await this.plugin.saveSettings();
                })
            );
        let currentPreset = "NONE";

        new Setting(containerMiscellaneousEl)
            .setName("Presets")
            .setDesc("Apply preset configuration")
            .addDropdown((dropdown) =>
                dropdown
                    .addOptions({ NONE: "", LIVESYNC: "LiveSync", PERIODIC: "Periodic w/ batch", DISABLE: "Disable all sync" })
                    .setValue(currentPreset)
                    .onChange((value) => (currentPreset = value))
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply")
                    .setDisabled(false)
                    .setCta()
                    .onClick(async () => {
                        if (currentPreset == "") {
                            Logger("Select any preset.", LOG_LEVEL.NOTICE);
                            return;
                        }
                        this.plugin.settings.batchSave = false;
                        this.plugin.settings.liveSync = false;
                        this.plugin.settings.periodicReplication = false;
                        this.plugin.settings.syncOnSave = false;
                        this.plugin.settings.syncOnStart = false;
                        this.plugin.settings.syncOnFileOpen = false;
                        this.plugin.settings.syncAfterMerge = false;
                        if (currentPreset == "LIVESYNC") {
                            this.plugin.settings.liveSync = true;
                            Logger("Synchronization setting configured as LiveSync.", LOG_LEVEL.NOTICE);
                        } else if (currentPreset == "PERIODIC") {
                            this.plugin.settings.batchSave = true;
                            this.plugin.settings.periodicReplication = true;
                            this.plugin.settings.syncOnSave = false;
                            this.plugin.settings.syncOnStart = true;
                            this.plugin.settings.syncOnFileOpen = true;
                            this.plugin.settings.syncAfterMerge = true;
                            Logger("Synchronization setting configured as Periodic sync with batch database update.", LOG_LEVEL.NOTICE);
                        } else {
                            Logger("All synchronization disabled.", LOG_LEVEL.NOTICE);
                        }
                        this.plugin.saveSettings();
                        await this.plugin.realizeSettingSyncMode();
                        if (inWizard) {
                            // @ts-ignore
                            this.plugin.app.setting.close()
                            await this.plugin.resetLocalDatabase();
                            await this.plugin.initializeDatabase(true);
                            if (rebuildRemote) {
                                await this.plugin.markRemoteLocked();
                                await this.plugin.tryResetRemoteDatabase();
                                await this.plugin.markRemoteLocked();
                                await this.plugin.markRemoteResolved();
                            }
                            await this.plugin.replicate(true);

                            Logger("All done! Please set up subsequent devices with 'Copy setup URI' and 'Open setup URI'.", LOG_LEVEL.NOTICE);
                            // @ts-ignore
                            this.plugin.app.commands.executeCommandById("obsidian-livesync:livesync-copysetupuri")
                        }


                    })
            );

        const passphrase_options: Record<ConfigPassphraseStore, string> = {
            "": "Default",
            LOCALSTORAGE: "Use a custom passphrase",
            ASK_AT_LAUNCH: "Ask an passphrase at every launch",
        }
        new Setting(containerMiscellaneousEl)
            .setName("Encrypting sensitive configuration items")
            .addDropdown((dropdown) =>
                dropdown
                    .addOptions(passphrase_options)
                    .setValue(this.plugin.settings.configPassphraseStore)
                    .onChange(async (value) => {
                        this.plugin.settings.configPassphraseStore = value as ConfigPassphraseStore;
                        this.plugin.usedPassphrase = "";
                        confPassphraseSetting.setDisabled(this.plugin.settings.configPassphraseStore != "LOCALSTORAGE");
                        await this.plugin.saveSettings();
                    })
            )
            .setClass("wizardHidden");


        const confPassphrase = localStorage.getItem("ls-setting-passphrase") || "";
        const confPassphraseSetting = new Setting(containerMiscellaneousEl)
            .setName("Passphrase of sensitive configuration items")
            .setDesc("This passphrase will not be copied to another device. It will be set to `Default` until you configure it again.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(confPassphrase)
                    .onChange(async (value) => {
                        this.plugin.usedPassphrase = "";
                        localStorage.setItem("ls-setting-passphrase", value);
                        await this.plugin.saveSettings();
                        markDirtyControl();
                    });
                text.inputEl.setAttribute("type", "password");
            })
            .setClass("wizardHidden");
        confPassphraseSetting.setDisabled(this.plugin.settings.configPassphraseStore != "LOCALSTORAGE");

        const infoApply = containerMiscellaneousEl.createEl("div", { text: `To finish setup, please select one of the presets` });
        infoApply.addClass("op-warn-info");
        infoApply.addClass("wizardOnly")

        addScreenElement("40", containerMiscellaneousEl);

        const containerHatchEl = containerEl.createDiv();

        containerHatchEl.createEl("h3", { text: "Hatch" });


        new Setting(containerHatchEl)
            .setName("Make report to inform the issue")
            .addButton((button) =>
                button
                    .setButtonText("Make report")
                    .setDisabled(false)
                    .onClick(async () => {
                        let responseConfig: any = {};
                        const REDACTED = "𝑅𝐸𝐷𝐴𝐶𝑇𝐸𝐷";
                        try {
                            const r = await requestToCouchDB(this.plugin.settings.couchDB_URI, this.plugin.settings.couchDB_USER, this.plugin.settings.couchDB_PASSWORD, window.origin);

                            Logger(JSON.stringify(r.json, null, 2));

                            responseConfig = r.json;
                            responseConfig["couch_httpd_auth"].secret = REDACTED;
                            responseConfig["couch_httpd_auth"].authentication_db = REDACTED;
                            responseConfig["couch_httpd_auth"].authentication_redirect = REDACTED;
                            responseConfig["couchdb"].uuid = REDACTED;
                            responseConfig["admins"] = REDACTED;

                        } catch (ex) {
                            responseConfig = "Requesting information to the remote CouchDB has been failed. If you are using IBM Cloudant, it is the normal behaviour."
                        }
                        const pluginConfig = JSON.parse(JSON.stringify(this.plugin.settings)) as ObsidianLiveSyncSettings;
                        pluginConfig.couchDB_DBNAME = REDACTED;
                        pluginConfig.couchDB_PASSWORD = REDACTED;
                        pluginConfig.couchDB_URI = isCloudantURI(pluginConfig.couchDB_URI) ? "cloudant" : "self-hosted";
                        pluginConfig.couchDB_USER = REDACTED;
                        pluginConfig.passphrase = REDACTED;
                        pluginConfig.encryptedPassphrase = REDACTED;
                        pluginConfig.encryptedCouchDBConnection = REDACTED;

                        const msgConfig = `----remote config----
${stringifyYaml(responseConfig)}
---- Plug-in config ---
${stringifyYaml(pluginConfig)}`;
                        console.log(msgConfig);
                        await navigator.clipboard.writeText(msgConfig);
                        Logger(`Information has been copied to clipboard`, LOG_LEVEL.NOTICE);
                    })
            );

        if (this.plugin.localDatabase.remoteLockedAndDeviceNotAccepted) {
            const c = containerHatchEl.createEl("div", {
                text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization, and this device was not marked as 'resolved'. it caused by some operations like this. re-initialized. Local database initialization should be required. please back your vault up, reset local database, and press 'Mark this device as resolved'. ",
            });
            c.createEl("button", { text: "I'm ready, mark this device 'resolved'" }, (e) => {
                e.addClass("mod-warning");
                e.addEventListener("click", async () => {
                    await this.plugin.markRemoteResolved();
                    c.remove();
                });
            });
            c.addClass("op-warn");
        } else {
            if (this.plugin.localDatabase.remoteLocked) {
                const c = containerHatchEl.createEl("div", {
                    text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization. (This device is marked 'resolved') When all your devices are marked 'resolved', unlock the database.",
                });
                c.createEl("button", { text: "I'm ready, unlock the database" }, (e) => {
                    e.addClass("mod-warning");
                    e.addEventListener("click", async () => {
                        await this.plugin.markRemoteUnlocked();
                        c.remove();
                    });
                });
                c.addClass("op-warn");
            }
        }
        const hatchWarn = containerHatchEl.createEl("div", { text: `To stop the boot up sequence for fixing problems on databases, you can put redflag.md on top of your vault (Rebooting obsidian is required).` });
        hatchWarn.addClass("op-warn-info");

        new Setting(containerHatchEl)
            .setName("Verify and repair all files")
            .setDesc("Verify and repair all files and update database without restoring")
            .addButton((button) =>
                button
                    .setButtonText("Verify and repair")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        const semaphore = Semaphore(10);
                        const files = this.app.vault.getFiles();
                        let i = 0;
                        const processes = files.map(e => (async (file) => {
                            const releaser = await semaphore.acquire(1, "verifyAndRepair");

                            try {
                                Logger(`UPDATE DATABASE ${file.path}`);
                                await this.plugin.updateIntoDB(file, false, null, true);
                                i++;
                                Logger(`${i}/${files.length}\n${file.path}`, LOG_LEVEL.NOTICE, "verify");

                            } catch (ex) {
                                i++;
                                Logger(`Error while verifyAndRepair`, LOG_LEVEL.NOTICE);
                                Logger(ex);
                            } finally {
                                releaser();
                            }
                        }
                        )(e));
                        await Promise.all(processes);
                        Logger("done", LOG_LEVEL.NOTICE, "verify");
                    })
            );

        new Setting(containerHatchEl)
            .setName("Suspend file watching")
            .setDesc("Stop watching for file change.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.suspendFileWatching).onChange(async (value) => {
                    this.plugin.settings.suspendFileWatching = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerHatchEl)
            .setName("Discard local database to reset or uninstall Self-hosted LiveSync")
            .addButton((button) =>
                button
                    .setButtonText("Discard")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.resetLocalDatabase();
                        await this.plugin.initializeDatabase();
                    })
            );

        addScreenElement("50", containerHatchEl);
        // With great respect, thank you TfTHacker!
        // Refer: https://github.com/TfTHacker/obsidian42-brat/blob/main/src/features/BetaPlugins.ts
        const containerPluginSettings = containerEl.createDiv();
        containerPluginSettings.createEl("h3", { text: "Plugins and settings (beta)" });

        const updateDisabledOfDeviceAndVaultName = () => {
            vaultName.setDisabled(this.plugin.settings.autoSweepPlugins || this.plugin.settings.autoSweepPluginsPeriodic);
            vaultName.setTooltip(this.plugin.settings.autoSweepPlugins || this.plugin.settings.autoSweepPluginsPeriodic ? "You could not change when you enabling auto scan." : "");
        };
        new Setting(containerPluginSettings).setName("Enable plugin synchronization").addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.usePluginSync).onChange(async (value) => {
                this.plugin.settings.usePluginSync = value;
                await this.plugin.saveSettings();
            })
        );

        new Setting(containerPluginSettings)
            .setName("Scan plugins automatically")
            .setDesc("Scan plugins before replicating.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoSweepPlugins).onChange(async (value) => {
                    this.plugin.settings.autoSweepPlugins = value;
                    updateDisabledOfDeviceAndVaultName();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerPluginSettings)
            .setName("Scan plugins periodically")
            .setDesc("Scan plugins every 1 minute. This configuration will be ignored if monitoring changes of hidden files has been enabled.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoSweepPluginsPeriodic).onChange(async (value) => {
                    this.plugin.settings.autoSweepPluginsPeriodic = value;
                    updateDisabledOfDeviceAndVaultName();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerPluginSettings)
            .setName("Notify updates")
            .setDesc("Notify when any device has a newer plugin or its setting.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.notifyPluginOrSettingUpdated).onChange(async (value) => {
                    this.plugin.settings.notifyPluginOrSettingUpdated = value;
                    await this.plugin.saveSettings();
                })
            );
        const vaultName = new Setting(containerPluginSettings)
            .setName("Device and Vault name")
            .setDesc("")
            .addText((text) => {
                text.setPlaceholder("desktop-main")
                    .setValue(this.plugin.deviceAndVaultName)
                    .onChange(async (value) => {
                        this.plugin.deviceAndVaultName = value;
                        await this.plugin.saveSettings();
                    });
                // text.inputEl.setAttribute("type", "password");
            });
        new Setting(containerPluginSettings)
            .setName("Open")
            .setDesc("Open the plugin dialog")
            .addButton((button) => {
                button
                    .setButtonText("Open")
                    .setDisabled(false)
                    .onClick(() => {
                        this.plugin.showPluginSyncModal();
                    });
            });

        updateDisabledOfDeviceAndVaultName();

        addScreenElement("60", containerPluginSettings);

        const containerCorruptedDataEl = containerEl.createDiv();

        containerCorruptedDataEl.createEl("h3", { text: "Corrupted or missing data" });
        containerCorruptedDataEl.createEl("h4", { text: "Corrupted" });
        if (Object.keys(this.plugin.localDatabase.corruptedEntries).length > 0) {
            const cx = containerCorruptedDataEl.createEl("div", { text: "If you have a copy of these files on any device, simply edit them once and sync. If not, there's nothing we can do except deleting them. sorry.." });
            for (const k in this.plugin.localDatabase.corruptedEntries) {
                const xx = cx.createEl("div", { text: `${k}` });

                const ba = xx.createEl("button", { text: `Delete this` }, (e) => {
                    e.addEventListener("click", async () => {
                        await this.plugin.localDatabase.deleteDBEntry(k);
                        xx.remove();
                    });
                });
                ba.addClass("mod-warning");
                xx.createEl("button", { text: `Restore from file` }, (e) => {
                    e.addEventListener("click", async () => {
                        const f = await this.app.vault.getFiles().filter((e) => path2id(e.path) == k);
                        if (f.length == 0) {
                            Logger("Not found in vault", LOG_LEVEL.NOTICE);
                            return;
                        }
                        await this.plugin.updateIntoDB(f[0]);
                        xx.remove();
                    });
                });
                xx.addClass("mod-warning");
            }
        } else {
            containerCorruptedDataEl.createEl("div", { text: "There is no corrupted data." });
        }
        containerCorruptedDataEl.createEl("h4", { text: "Missing or waiting" });
        if (Object.keys(this.plugin.queuedFiles).length > 0) {
            const cx = containerCorruptedDataEl.createEl("div", {
                text: "These files have missing or waiting chunks. Perhaps these chunks will arrive in a while after replication. But if they don't, you have to restore it's database entry from a existing local file by hitting the button below.",
            });
            const files = [...new Set([...this.plugin.queuedFiles.map((e) => e.entry._id)])];
            for (const k of files) {
                const xx = cx.createEl("div", { text: `${id2path(k)}` });

                const ba = xx.createEl("button", { text: `Delete this` }, (e) => {
                    e.addEventListener("click", async () => {
                        await this.plugin.localDatabase.deleteDBEntry(k);
                        xx.remove();
                    });
                });
                ba.addClass("mod-warning");
                xx.createEl("button", { text: `Restore from file` }, (e) => {
                    e.addEventListener("click", async () => {
                        const f = await this.app.vault.getFiles().filter((e) => path2id(e.path) == k);
                        if (f.length == 0) {
                            Logger("Not found in vault", LOG_LEVEL.NOTICE);
                            return;
                        }
                        await this.plugin.updateIntoDB(f[0]);
                        xx.remove();
                    });
                });
                xx.addClass("mod-warning");
            }
        } else {
            containerCorruptedDataEl.createEl("div", { text: "There is no missing or waiting chunk." });
        }
        applyDisplayEnabled();
        addScreenElement("70", containerCorruptedDataEl);
        if (lastVersion != this.plugin.settings.lastReadUpdates) {
            if (JSON.stringify(this.plugin.settings) != JSON.stringify(DEFAULT_SETTINGS)) {
                changeDisplay("100");
            } else {
                changeDisplay("110")
            }
        } else {
            if (isAnySyncEnabled()) {
                changeDisplay("0");
            } else {
                changeDisplay("110")
            }
        }
    }
}
