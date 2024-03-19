import { App, PluginSettingTab, Setting, sanitizeHTMLToDom, TextAreaComponent, MarkdownRenderer, stringifyYaml } from "./deps";
import { DEFAULT_SETTINGS, type ObsidianLiveSyncSettings, type ConfigPassphraseStore, type RemoteDBSettings, type FilePathWithPrefix, type HashAlgorithm, type DocumentID, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, LOG_LEVEL_INFO, type LoadedEntry, PREFERRED_SETTING_CLOUDANT, PREFERRED_SETTING_SELF_HOSTED } from "./lib/src/types";
import { createBlob, delay, isDocContentSame, readAsBlob } from "./lib/src/utils";
import { versionNumberString2Number } from "./lib/src/strbin";
import { Logger } from "./lib/src/logger";
import { checkSyncInfo, isCloudantURI } from "./lib/src/utils_couchdb";
import { testCrypt } from "./lib/src/e2ee_v2";
import ObsidianLiveSyncPlugin from "./main";
import { askYesNo, performRebuildDB, requestToCouchDB, scheduleTask } from "./utils";
import { request, type ButtonComponent, TFile } from "obsidian";
import { shouldBeIgnored } from "./lib/src/path";


export class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;
    selectedScreen = "";

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    async testConnection(): Promise<void> {
        const db = await this.plugin.replicator.connectRemoteCouchDBWithSetting(this.plugin.settings, this.plugin.isMobile, true);
        if (typeof db === "string") {
            this.plugin.addLog(`could not connect to ${this.plugin.settings.couchDB_URI} : ${this.plugin.settings.couchDB_DBNAME} \n(${db})`, LOG_LEVEL_NOTICE);
            return;
        }
        this.plugin.addLog(`Connected to ${db.info.db_name}`, LOG_LEVEL_NOTICE);
    }
    askReload() {
        scheduleTask("configReload", 250, async () => {
            if (await askYesNo(this.app, "Do you want to restart and reload Obsidian now?") == "yes") {
                // @ts-ignore
                this.app.commands.executeCommandById("app:reload")
            }
        })
    }
    closeSetting() {
        // @ts-ignore
        this.plugin.app.setting.close()
    }
    display(): void {
        const { containerEl } = this;
        let encrypt = this.plugin.settings.encrypt;
        let passphrase = this.plugin.settings.passphrase;
        let useDynamicIterationCount = this.plugin.settings.useDynamicIterationCount;

        containerEl.empty();

        // const preferred_setting = isCloudantURI(this.plugin.settings.couchDB_URI) ? PREFERRED_SETTING_CLOUDANT : PREFERRED_SETTING_SELF_HOSTED;
        // const default_setting = { ...DEFAULT_SETTINGS };


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
<label class='sls-setting-label c-110'><input type='radio' name='disp' value='110' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🧙‍♂️</div></label>
<label class='sls-setting-label c-20 wizardHidden'><input type='radio' name='disp' value='20' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>⚙️</div></label>
<label class='sls-setting-label c-0'><input type='radio' name='disp' value='0' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🛰️</div></label>
<label class='sls-setting-label c-30'><input type='radio' name='disp' value='30' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🔁</div></label>
<label class='sls-setting-label c-60 wizardHidden'><input type='radio' name='disp' value='60' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🔌</div></label>
<label class='sls-setting-label c-50 wizardHidden'><input type='radio' name='disp' value='50' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🧰</div></label>
<label class='sls-setting-label c-70 wizardHidden'><input type='radio' name='disp' value='70' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🎛️</div></label>
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
                (element.querySelector<HTMLInputElement>("input[type=radio]"))!.checked = false;
            });
            w.querySelectorAll(`.sls-setting-label.c-${screen}`).forEach((element) => {
                element.addClass("selected");
                (element.querySelector<HTMLInputElement>("input[type=radio]"))!.checked = true;
            });
            this.selectedScreen = screen;
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
            informationButtonDiv.querySelector("button")?.addEventListener("click", async () => {
                this.plugin.settings.lastReadUpdates = lastVersion;
                await this.plugin.saveSettings();
                informationButtonDiv.remove();
            });

        }

        MarkdownRenderer.render(this.plugin.app, updateInformation, informationDivEl, "/", this.plugin);


        addScreenElement("100", containerInformationEl);
        const isAnySyncEnabled = (): boolean => {
            if (this.plugin.settings.liveSync) return true;
            if (this.plugin.settings.periodicReplication) return true;
            if (this.plugin.settings.syncOnFileOpen) return true;
            if (this.plugin.settings.syncOnSave) return true;
            if (this.plugin.settings.syncOnEditorSave) return true;
            if (this.plugin.settings.syncOnStart) return true;
            if (this.plugin.settings.syncAfterMerge) return true;
            if (this.plugin.replicator.syncStatus == "CONNECTED") return true;
            if (this.plugin.replicator.syncStatus == "PAUSED") return true;
            return false;
        };
        let inWizard = false;

        const setupWizardEl = containerEl.createDiv();
        setupWizardEl.createEl("h3", { text: "Setup wizard" });
        new Setting(setupWizardEl)
            .setName("Use the copied setup URI")
            .setDesc("To setup Self-hosted LiveSync, this method is the most preferred one.")
            .addButton((text) => {
                text.setButtonText("Use").onClick(async () => {
                    this.closeSetting();
                    await this.plugin.addOnSetup.command_openSetupURI();
                })
            })
        if (this.plugin.settings.isConfigured) {
            new Setting(setupWizardEl)
                .setName("Copy current settings as a new setup URI")
                .addButton((text) => {
                    text.setButtonText("Copy").onClick(async () => {
                        await this.plugin.addOnSetup.command_copySetupURI();
                    })
                })
        }
        new Setting(setupWizardEl)
            .setName("Minimal setup")
            .addButton((text) => {
                text.setButtonText("Start").onClick(async () => {
                    this.plugin.settings.liveSync = false;
                    this.plugin.settings.periodicReplication = false;
                    this.plugin.settings.syncOnSave = false;
                    this.plugin.settings.syncOnEditorSave = false;
                    this.plugin.settings.syncOnStart = false;
                    this.plugin.settings.syncOnFileOpen = false;
                    this.plugin.settings.syncAfterMerge = false;
                    this.plugin.replicator.closeReplication();
                    await this.plugin.saveSettings();
                    containerEl.addClass("isWizard");
                    applyDisplayEnabled();
                    inWizard = true;
                    changeDisplay("0")
                })
            })
        if (!this.plugin.settings.isConfigured) {
            new Setting(setupWizardEl)
                .setName("Enable LiveSync on this device as the set-up was completed manually")
                .addButton((text) => {
                    text.setButtonText("Enable").onClick(async () => {
                        this.plugin.settings.isConfigured = true;
                        await this.plugin.saveSettings();
                        this.askReload();
                    })
                })
        }
        if (this.plugin.settings.isConfigured) {
            new Setting(setupWizardEl)
                .setName("Discard exist settings and databases")
                .addButton((text) => {
                    text.setButtonText("Discard").onClick(async () => {
                        if (await askYesNo(this.plugin.app, "Do you really want to discard exist settings and databases?") == "yes") {
                            this.plugin.settings = { ...DEFAULT_SETTINGS };
                            await this.plugin.saveSettingData();
                            await this.plugin.resetLocalDatabase();
                            // await this.plugin.initializeDatabase();
                            this.askReload();
                        }
                    }).setWarning()
                })
        }
        setupWizardEl.createEl("h3", { text: "Online Tips" });
        const repo = "vrtmrz/obsidian-livesync";
        const topPath = "/docs/troubleshooting.md";
        const rawRepoURI = `https://raw.githubusercontent.com/${repo}/main`;
        setupWizardEl.createEl("div", "", el => el.innerHTML = `<a href='https://github.com/${repo}/blob/main${topPath}' target="_blank">Open in browser</a>`);
        const troubleShootEl = setupWizardEl.createEl("div", { text: "", cls: "sls-troubleshoot-preview" });
        const loadMarkdownPage = async (pathAll: string, basePathParam: string = "") => {
            troubleShootEl.style.minHeight = troubleShootEl.clientHeight + "px";
            troubleShootEl.empty();
            const fullPath = pathAll.startsWith("/") ? pathAll : `${basePathParam}/${pathAll}`;

            const directoryArr = fullPath.split("/");
            const filename = directoryArr.pop();
            const directly = directoryArr.join("/");
            const basePath = directly;

            let remoteTroubleShootMDSrc = "";
            try {
                remoteTroubleShootMDSrc = await request(`${rawRepoURI}${basePath}/${filename}`);
            } catch (ex: any) {
                remoteTroubleShootMDSrc = "Error Occurred!!\n" + ex.toString();
            }
            const remoteTroubleShootMD = remoteTroubleShootMDSrc.replace(/\((.*?(.png)|(.jpg))\)/g, `(${rawRepoURI}${basePath}/$1)`)
            // Render markdown
            await MarkdownRenderer.render(this.plugin.app, `<a class='sls-troubleshoot-anchor'></a> [Tips and Troubleshooting](${topPath}) [PageTop](${filename})\n\n${remoteTroubleShootMD}`, troubleShootEl, `${rawRepoURI}`, this.plugin);
            // Menu
            troubleShootEl.querySelector<HTMLAnchorElement>(".sls-troubleshoot-anchor")?.parentElement?.setCssStyles({ position: "sticky", top: "-1em", backgroundColor: "var(--modal-background)" });
            // Trap internal links.
            troubleShootEl.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((anchorEl) => {
                anchorEl.addEventListener("click", async (evt) => {
                    const uri = anchorEl.getAttr("data-href");
                    if (!uri) return;
                    if (uri.startsWith("#")) {
                        evt.preventDefault();
                        const elements = Array.from(troubleShootEl.querySelectorAll<HTMLHeadingElement>("[data-heading]"))
                        const p = elements.find(e => e.getAttr("data-heading")?.toLowerCase().split(" ").join("-") == uri.substring(1).toLowerCase());
                        if (p) {
                            p.setCssStyles({ scrollMargin: "3em" });
                            p.scrollIntoView({ behavior: "instant", block: "start" });
                        }
                    } else {
                        evt.preventDefault();
                        await loadMarkdownPage(uri, basePath);
                        troubleShootEl.setCssStyles({ scrollMargin: "1em" });
                        troubleShootEl.scrollIntoView({ behavior: "instant", block: "start" });
                    }
                })
            })
            troubleShootEl.style.minHeight = "";
        }
        loadMarkdownPage(topPath);
        addScreenElement("110", setupWizardEl);

        const containerRemoteDatabaseEl = containerEl.createDiv();
        containerRemoteDatabaseEl.createEl("h3", { text: "Remote Database configuration" });
        const syncWarn = containerRemoteDatabaseEl.createEl("div", { text: `These settings are kept locked while any synchronization options are enabled. Disable these options in the "Sync Settings" tab to unlock.` });
        if (this.plugin.settings.couchDB_URI.startsWith("http://")) {
            if (this.plugin.isMobile) {
                containerRemoteDatabaseEl.createEl("div", { text: `Configured as using plain HTTP. We cannot connect to the remote. Please set up the credentials and use HTTPS for the remote URI.` })
                    .addClass("op-warn");
            } else {
                containerRemoteDatabaseEl.createEl("div", { text: `Configured as using plain HTTP. We might fail on mobile devices.` })
                    .addClass("op-warn-info");
            }
        }

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
            } else if (this.plugin.settings.syncOnFileOpen || this.plugin.settings.syncOnSave || this.plugin.settings.syncOnEditorSave || this.plugin.settings.syncOnStart || this.plugin.settings.periodicReplication || this.plugin.settings.syncAfterMerge) {
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

        new Setting(containerRemoteDatabaseEl)
            .setName("Test Database Connection")
            .setClass("wizardHidden")
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
            .setName("Check and Fix database configuration")
            .setDesc("Check the database configuration, and fix if there are any problems.")
            .addButton((button) =>
                button
                    .setButtonText("Check")
                    .setDisabled(false)
                    .onClick(async () => {
                        const checkConfig = async () => {
                            Logger(`Checking database configuration`, LOG_LEVEL_INFO);

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
                            try {

                                if (isCloudantURI(this.plugin.settings.couchDB_URI)) {
                                    Logger("This feature cannot be used with IBM Cloudant.", LOG_LEVEL_NOTICE);
                                    return;
                                }
                                const r = await requestToCouchDB(this.plugin.settings.couchDB_URI, this.plugin.settings.couchDB_USER, this.plugin.settings.couchDB_PASSWORD, window.origin);
                                const responseConfig = r.json;

                                const addConfigFixButton = (title: string, key: string, value: string) => {
                                    const tmpDiv = createDiv();
                                    tmpDiv.addClass("ob-btn-config-fix");
                                    tmpDiv.innerHTML = `<label>${title}</label><button>Fix</button>`;
                                    const x = checkResultDiv.appendChild(tmpDiv);
                                    x.querySelector("button")?.addEventListener("click", async () => {
                                        Logger(`CouchDB Configuration: ${title} -> Set ${key} to ${value}`)
                                        const res = await requestToCouchDB(this.plugin.settings.couchDB_URI, this.plugin.settings.couchDB_USER, this.plugin.settings.couchDB_PASSWORD, undefined, key, value);
                                        if (res.status == 200) {
                                            Logger(`CouchDB Configuration: ${title} successfully updated`, LOG_LEVEL_NOTICE);
                                            checkResultDiv.removeChild(x);
                                            checkConfig();
                                        } else {
                                            Logger(`CouchDB Configuration: ${title} failed`, LOG_LEVEL_NOTICE);
                                            Logger(res.text, LOG_LEVEL_VERBOSE);
                                        }
                                    });
                                };
                                addResult("---Notice---", ["ob-btn-config-head"]);
                                addResult(
                                    "If the server configuration is not persistent (e.g., running on docker), the values set from here will also be volatile. Once you are able to connect, please reflect the settings in the server's local.ini.",
                                    ["ob-btn-config-info"]
                                );

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
                                    const responseHeaders = Object.fromEntries(Object.entries(rr.headers)
                                        .map((e) => {
                                            e[0] = `${e[0]}`.toLowerCase();
                                            return e;
                                        }));
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
                                Logger(`Checking configuration done`, LOG_LEVEL_INFO);
                            } catch (ex: any) {
                                if (ex?.status == 401) {
                                    addResult(`❗ Access forbidden.`);
                                    addResult(`We could not continue the test.`);
                                    Logger(`Checking configuration done`, LOG_LEVEL_INFO);
                                } else {
                                    Logger(`Checking configuration failed`, LOG_LEVEL_NOTICE);
                                    Logger(ex);
                                }
                            }
                        };
                        await checkConfig();
                    })
            );
        const checkResultDiv = containerRemoteDatabaseEl.createEl("div", {
            text: "",
        });

        containerRemoteDatabaseEl.createEl("h4", { text: "Confidentiality" });

        const e2e = new Setting(containerRemoteDatabaseEl)
            .setName("End to End Encryption")
            .setDesc("Encrypt contents on the remote database. If you use the plugin's synchronization feature, enabling this is recommend.")
            .addToggle((toggle) =>
                toggle.setValue(encrypt).onChange(async (value) => {
                    if (inWizard) {
                        this.plugin.settings.encrypt = value;
                        encrypt = value;
                        await this.plugin.saveSettings();
                        updateE2EControls();
                    } else {
                        encrypt = value;
                        // await this.plugin.saveSettings();
                        // this.display();
                        updateE2EControls();
                    }
                })
            );


        let usePathObfuscation = this.plugin.settings.usePathObfuscation;


        const updateE2EControls = () => {
            e2e.controlEl.toggleClass("sls-item-dirty", encrypt != this.plugin.settings.encrypt);
            if (encrypt) {
                passphraseSetting.settingEl.removeClass("sls-setting-hidden");
                dynamicIteration.settingEl.removeClass("sls-setting-hidden");
                usePathObfuscationEl.settingEl.removeClass("sls-setting-hidden");
                passphraseSetting?.controlEl.toggleClass("sls-item-dirty", passphrase != this.plugin.settings.passphrase);
                dynamicIteration?.controlEl.toggleClass("sls-item-dirty", useDynamicIterationCount != this.plugin.settings.useDynamicIterationCount);
                usePathObfuscationEl?.controlEl.toggleClass("sls-item-dirty", usePathObfuscation != this.plugin.settings.usePathObfuscation);

            } else {
                passphraseSetting.settingEl.addClass("sls-setting-hidden");
                dynamicIteration.settingEl.addClass("sls-setting-hidden");
                usePathObfuscationEl.settingEl.addClass("sls-setting-hidden");
            }
            if (encrypt != this.plugin.settings.encrypt ||
                passphrase != this.plugin.settings.passphrase ||
                useDynamicIterationCount != this.plugin.settings.useDynamicIterationCount ||
                usePathObfuscation != this.plugin.settings.usePathObfuscation) {
                applyE2EButtons.settingEl.removeClass("sls-setting-hidden");
            } else {
                applyE2EButtons.settingEl.addClass("sls-setting-hidden");
            }
        }
        // if (showEncryptOptionDetail) {
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
                            updateE2EControls();
                        }
                    });
                text.inputEl.setAttribute("type", "password");
            });

        const usePathObfuscationEl = new Setting(containerRemoteDatabaseEl)
            .setName("Path Obfuscation")
            .setDesc("Obfuscate paths of files. If we configured, we should rebuild the database.")
            .addToggle((toggle) =>
                toggle.setValue(usePathObfuscation).onChange(async (value) => {
                    if (inWizard) {
                        this.plugin.settings.usePathObfuscation = value;
                        await this.plugin.saveSettings();
                    } else {
                        usePathObfuscation = value;
                        await this.plugin.saveSettings();
                        updateE2EControls();
                    }
                })
            );

        const dynamicIteration = new Setting(containerRemoteDatabaseEl)
            .setName("Use dynamic iteration count (experimental)")
            .setDesc("Balancing the encryption/decryption load against the length of the passphrase if toggled.")
            .addToggle((toggle) => {
                toggle.setValue(useDynamicIterationCount)
                    .onChange(async (value) => {
                        if (inWizard) {
                            this.plugin.settings.useDynamicIterationCount = value;
                            await this.plugin.saveSettings();
                        } else {
                            useDynamicIterationCount = value;
                            await this.plugin.saveSettings();
                            updateE2EControls();
                        }
                    });
            })
            .setClass("wizardHidden");
        // }
        const applyE2EButtons = new Setting(containerRemoteDatabaseEl)
            .setName("Apply")
            .setDesc("Apply encryption settings")
            .setClass("wizardHidden")
            .addButton((button) =>
                button
                    .setButtonText("Just apply")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await applyEncryption(false);
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply and Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("localOnly");
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply and Rebuild")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("rebuildBothByThisDevice");
                    })
            );


        updateE2EControls();
        const checkWorkingPassphrase = async (): Promise<boolean> => {
            const settingForCheck: RemoteDBSettings = {
                ...this.plugin.settings,
                encrypt: encrypt,
                passphrase: passphrase,
                useDynamicIterationCount: useDynamicIterationCount,
            };
            console.dir(settingForCheck);
            const db = await this.plugin.replicator.connectRemoteCouchDBWithSetting(settingForCheck, this.plugin.isMobile, true);
            if (typeof db === "string") {
                Logger("Could not connect to the database.", LOG_LEVEL_NOTICE);
                return false;
            } else {
                if (await checkSyncInfo(db.db)) {
                    // Logger("Database connected", LOG_LEVEL_NOTICE);
                    return true;
                } else {
                    Logger("Failed to read remote database", LOG_LEVEL_NOTICE);
                    return false;
                }
            }
        };
        const applyEncryption = async (sendToServer: boolean) => {
            if (encrypt && passphrase == "") {
                Logger("If you enable encryption, you have to set the passphrase", LOG_LEVEL_NOTICE);
                return;
            }
            if (encrypt && !(await testCrypt())) {
                Logger("WARNING! Your device would not support encryption.", LOG_LEVEL_NOTICE);
                return;
            }
            if (!(await checkWorkingPassphrase()) && !sendToServer) {
                return;
            }
            if (!encrypt) {
                passphrase = "";
            }
            this.plugin.addOnSetup.suspendAllSync();
            this.plugin.addOnSetup.suspendExtraSync();
            this.plugin.settings.encrypt = encrypt;
            this.plugin.settings.passphrase = passphrase;
            this.plugin.settings.useDynamicIterationCount = useDynamicIterationCount;
            this.plugin.settings.usePathObfuscation = usePathObfuscation;
            this.plugin.settings.isConfigured = true;
            await this.plugin.saveSettings();
            updateE2EControls();
            if (sendToServer) {
                await this.plugin.addOnSetup.rebuildRemote()
            } else {
                await this.plugin.markRemoteResolved();
                await this.plugin.replicate(true);
            }
        };

        const rebuildDB = async (method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks") => {
            if (encrypt && passphrase == "") {
                Logger("If you enable encryption, you have to set the passphrase", LOG_LEVEL_NOTICE);
                return;
            }
            if (encrypt && !(await testCrypt())) {
                Logger("WARNING! Your device would not support encryption.", LOG_LEVEL_NOTICE);
                return;
            }
            if (!encrypt) {
                passphrase = "";
            }
            this.plugin.addOnSetup.suspendAllSync();
            this.plugin.addOnSetup.suspendExtraSync();
            this.plugin.settings.encrypt = encrypt;
            this.plugin.settings.passphrase = passphrase;
            this.plugin.settings.useDynamicIterationCount = useDynamicIterationCount;
            this.plugin.settings.usePathObfuscation = usePathObfuscation;
            this.plugin.settings.isConfigured = true;
            Logger("All synchronization have been temporarily disabled. Please enable them after the fetching, if you need them.", LOG_LEVEL_NOTICE)
            await this.plugin.saveSettings();
            updateE2EControls();
            applyDisplayEnabled();
            this.closeSetting();
            await delay(2000);
            await performRebuildDB(this.plugin, method);
        }


        new Setting(containerRemoteDatabaseEl)
            .setClass("wizardOnly")
            .addButton((button) =>
                button
                    .setButtonText("Next")
                    .setCta()
                    .setDisabled(false)
                    .onClick(() => {
                        if (!this.plugin.settings.encrypt) {
                            this.plugin.settings.passphrase = "";
                        }
                        if (isCloudantURI(this.plugin.settings.couchDB_URI)) {
                            // this.plugin.settings.customChunkSize = 0;
                            this.plugin.settings = { ...this.plugin.settings, ...PREFERRED_SETTING_CLOUDANT };
                        } else {
                            this.plugin.settings = { ...this.plugin.settings, ...PREFERRED_SETTING_SELF_HOSTED };
                        }
                        changeDisplay("30")
                    })
            )
            ;

        addScreenElement("0", containerRemoteDatabaseEl);

        const containerGeneralSettingsEl = containerEl.createDiv();
        containerGeneralSettingsEl.createEl("h3", { text: "General Settings" });

        containerGeneralSettingsEl.createEl("h4", { text: "Appearance" });

        new Setting(containerGeneralSettingsEl)
            .setName("Show status inside the editor")
            .setDesc("Reflected after reboot")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showStatusOnEditor).onChange(async (value) => {
                    this.plugin.settings.showStatusOnEditor = value;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
        if (this.plugin.settings.showStatusOnEditor) {
            new Setting(containerGeneralSettingsEl)
                .setName("Show status as icons only")
                .setDesc("")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.showOnlyIconsOnEditor).onChange(async (value) => {
                        this.plugin.settings.showOnlyIconsOnEditor = value;
                        await this.plugin.saveSettings();
                    })
                );
        }
        new Setting(containerGeneralSettingsEl)
            .setName("Show status on the status bar")
            .setDesc("Reflected after reboot.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showStatusOnStatusbar).onChange(async (value) => {
                    this.plugin.settings.showStatusOnStatusbar = value;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
        containerGeneralSettingsEl.createEl("h4", { text: "Logging" });
        new Setting(containerGeneralSettingsEl)
            .setName("Show only notifications")
            .setDesc("Prevent logging and show only notification")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.lessInformationInLog).onChange(async (value) => {
                    this.plugin.settings.lessInformationInLog = value;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
        if (!this.plugin.settings.lessInformationInLog) {
            new Setting(containerGeneralSettingsEl)
                .setName("Verbose Log")
                .setDesc("Show verbose log")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.showVerboseLog).onChange(async (value) => {
                        this.plugin.settings.showVerboseLog = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        containerGeneralSettingsEl.createEl("h4", { text: "Performance tweaks" });

        new Setting(containerGeneralSettingsEl)
            .setName("Memory cache size (by total items)")
            .setDesc("")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.hashCacheMaxCount + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10) {
                            v = 10;
                        }
                        this.plugin.settings.hashCacheMaxCount = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });
        new Setting(containerGeneralSettingsEl)
            .setName("Memory cache size (by total characters)")
            .setDesc("(Mega chars)")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.hashCacheMaxAmount + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 1) {
                            v = 1;
                        }
                        this.plugin.settings.hashCacheMaxAmount = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        containerGeneralSettingsEl.createEl("h4", { text: "Share settings via markdown" });
        let settingSyncFile = this.plugin.settings.settingSyncFile;
        let buttonApplyFilename: ButtonComponent;
        new Setting(containerGeneralSettingsEl)
            .setName("Filename")
            .setDesc("If you set this, all settings are saved in a markdown file. You will also be notified when new settings were arrived. You can set different files by the platform.")
            .addText((text) => {
                text.setPlaceholder("livesync/setting.md")
                    .setValue(settingSyncFile)
                    .onChange((value) => {
                        settingSyncFile = value;
                        if (settingSyncFile == this.plugin.settings.settingSyncFile) {
                            buttonApplyFilename.removeCta()
                            buttonApplyFilename.setDisabled(true);
                        } else {
                            buttonApplyFilename.setCta()
                            buttonApplyFilename.setDisabled(false);
                        }
                    })
            }).addButton(button => {
                button.setButtonText("Apply")
                    .onClick(async () => {
                        this.plugin.settings.settingSyncFile = settingSyncFile;
                        await this.plugin.saveSettings();
                        this.display();
                    })
                buttonApplyFilename = button;
            })
        new Setting(containerGeneralSettingsEl)
            .setName("Write credentials in the file")
            .setDesc("(Not recommended) If set, credentials will be stored in the file.")
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.writeCredentialsForSettingSync)
                    .onChange(async (value) => {
                        this.plugin.settings.writeCredentialsForSettingSync = value;
                        await this.plugin.saveSettings();
                    })
            });
        new Setting(containerGeneralSettingsEl)
            .setName("Notify all setting files")
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.notifyAllSettingSyncFile)
                    .onChange(async (value) => {
                        this.plugin.settings.notifyAllSettingSyncFile = value;
                        await this.plugin.saveSettings();
                    })
            });

        containerGeneralSettingsEl.createEl("h4", { text: "Advanced Confidentiality" });

        const passphrase_options: Record<ConfigPassphraseStore, string> = {
            "": "Default",
            LOCALSTORAGE: "Use a custom passphrase",
            ASK_AT_LAUNCH: "Ask an passphrase at every launch",
        }
        new Setting(containerGeneralSettingsEl)
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
        const confPassphraseSetting = new Setting(containerGeneralSettingsEl)
            .setName("Passphrase of sensitive configuration items")
            .setDesc("This passphrase will not be copied to another device. It will be set to `Default` until you configure it again.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(confPassphrase)
                    .onChange(async (value) => {
                        this.plugin.usedPassphrase = "";
                        localStorage.setItem("ls-setting-passphrase", value);
                        await this.plugin.saveSettings();
                        updateE2EControls();
                    });
                text.inputEl.setAttribute("type", "password");
            })
            .setClass("wizardHidden");
        confPassphraseSetting.setDisabled(this.plugin.settings.configPassphraseStore != "LOCALSTORAGE");

        addScreenElement("20", containerGeneralSettingsEl);
        const containerSyncSettingEl = containerEl.createDiv();
        containerSyncSettingEl.createEl("h3", { text: "Sync Settings" });
        // containerSyncSettingEl.addClass("wizardHidden")

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


        let currentPreset = "NONE";
        containerSyncSettingEl.createEl("div",
            { text: `Please select any preset to complete wizard.` }
        ).addClasses(["op-warn-info", "wizardOnly"]);
        new Setting(containerSyncSettingEl)
            .setName("Presets")
            .setDesc("Apply preset configuration")
            .addDropdown((dropdown) =>
                dropdown
                    .addOptions({ NONE: "", LIVESYNC: "LiveSync", PERIODIC: "Periodic w/ batch", DISABLE: "Disable all automatic" })
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
                            Logger("Select any preset.", LOG_LEVEL_NOTICE);
                            return;
                        }
                        const presetAllDisabled = {
                            batchSave: false,
                            liveSync: false,
                            periodicReplication: false,
                            syncOnSave: false,
                            syncOnEditorSave: false,
                            syncOnStart: false,
                            syncOnFileOpen: false,
                            syncAfterMerge: false,
                        } as Partial<ObsidianLiveSyncSettings>;
                        const presetLiveSync = {
                            ...presetAllDisabled,
                            liveSync: true
                        } as Partial<ObsidianLiveSyncSettings>;
                        const presetPeriodic = {
                            ...presetAllDisabled,
                            batchSave: true,
                            periodicReplication: true,
                            syncOnSave: false,
                            syncOnEditorSave: false,
                            syncOnStart: true,
                            syncOnFileOpen: true,
                            syncAfterMerge: true,
                        } as Partial<ObsidianLiveSyncSettings>;

                        if (currentPreset == "LIVESYNC") {
                            this.plugin.settings = {
                                ...this.plugin.settings,
                                ...presetLiveSync
                            }
                            Logger("Synchronization setting configured as LiveSync.", LOG_LEVEL_NOTICE);
                        } else if (currentPreset == "PERIODIC") {
                            this.plugin.settings = {
                                ...this.plugin.settings,
                                ...presetPeriodic
                            }
                            Logger("Synchronization setting configured as Periodic sync with batch database update.", LOG_LEVEL_NOTICE);
                        } else {
                            Logger("All synchronization disabled.", LOG_LEVEL_NOTICE);
                            this.plugin.settings = {
                                ...this.plugin.settings,
                                ...presetAllDisabled
                            }
                        }
                        await this.plugin.saveSettings();
                        this.display();
                        await this.plugin.realizeSettingSyncMode();
                        if (inWizard) {
                            this.closeSetting();
                            if (!this.plugin.settings.isConfigured) {
                                this.plugin.settings.isConfigured = true;
                                await this.plugin.saveSettings();
                                await rebuildDB("localOnly");
                                Logger("All done! Please set up subsequent devices with 'Copy current settings as a new setup URI' and 'Use the copied setup URI'.", LOG_LEVEL_NOTICE);
                                await this.plugin.addOnSetup.command_copySetupURI();
                            } else {
                                this.askReload();
                            }
                        }
                    })
            );

        containerSyncSettingEl.createEl("h4", { text: "Synchronization Methods" }).addClass("wizardHidden");
        const syncLive: Setting[] = [];
        const syncNonLive: Setting[] = [];
        let syncMode = "" as "" | "PERIODIC" | "LIVESYNC";
        if (this.plugin.settings.liveSync) {
            syncMode = "LIVESYNC";
        } else if (this.plugin.settings.periodicReplication) {
            syncMode = "PERIODIC";
        }
        new Setting(containerSyncSettingEl)
            .setName("Sync Mode")
            .setClass("wizardHidden")
            .addDropdown((dropdown) =>
                dropdown
                    .addOptions({ "": "On events", PERIODIC: "Periodic and On events", "LIVESYNC": "LiveSync" })
                    .setValue(syncMode)
                    .onChange(async (value) => {
                        this.plugin.settings.liveSync = false;
                        this.plugin.settings.periodicReplication = false;
                        if (value == "LIVESYNC") {
                            this.plugin.settings.liveSync = true;
                        } else if (value == "PERIODIC") {
                            this.plugin.settings.periodicReplication = true;
                        }
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                        await this.plugin.realizeSettingSyncMode();
                        this.display();
                    })
            )
        if (!this.plugin.settings.liveSync) {
            if (this.plugin.settings.periodicReplication) {
                new Setting(containerSyncSettingEl)
                    .setName("Periodic Sync interval")
                    .setDesc("Interval (sec)")
                    .setClass("wizardHidden")
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
                    })
            }

            new Setting(containerSyncSettingEl)
                .setName("Sync on Save")
                .setDesc("When you save file, sync automatically")
                .setClass("wizardHidden")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
                        this.plugin.settings.syncOnSave = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                )
            new Setting(containerSyncSettingEl)
                .setName("Sync on Editor Save")
                .setDesc("When you save file on the editor, sync automatically")
                .setClass("wizardHidden")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnEditorSave).onChange(async (value) => {
                        this.plugin.settings.syncOnEditorSave = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                )
            new Setting(containerSyncSettingEl)
                .setName("Sync on File Open")
                .setDesc("When you open file, sync automatically")
                .setClass("wizardHidden")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnFileOpen).onChange(async (value) => {
                        this.plugin.settings.syncOnFileOpen = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                )
            new Setting(containerSyncSettingEl)
                .setName("Sync on Start")
                .setDesc("Start synchronization after launching Obsidian.")
                .setClass("wizardHidden")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (value) => {
                        this.plugin.settings.syncOnStart = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                )
            new Setting(containerSyncSettingEl)
                .setName("Sync after merging file")
                .setDesc("Sync automatically after merging files")
                .setClass("wizardHidden")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncAfterMerge).onChange(async (value) => {
                        this.plugin.settings.syncAfterMerge = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                )
        }
        containerSyncSettingEl.createEl("h4", { text: "Deletions propagation" }).addClass("wizardHidden")
        new Setting(containerSyncSettingEl)
            .setName("Use the trash bin")
            .setDesc("Do not delete files that are deleted in remote, just move to trash.")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.trashInsteadDelete).onChange(async (value) => {
                    this.plugin.settings.trashInsteadDelete = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Keep empty folder")
            .setDesc("Normally, a folder is deleted when it becomes empty after a synchronization. Enabling this will prevent it from getting deleted")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.doNotDeleteFolder).onChange(async (value) => {
                    this.plugin.settings.doNotDeleteFolder = value;
                    await this.plugin.saveSettings();
                })
            );

        containerSyncSettingEl.createEl("h4", { text: "Conflict resolution" }).addClass("wizardHidden");

        new Setting(containerSyncSettingEl)
            .setName("Always overwrite with a newer file (beta)")
            .setDesc("(Def off) Resolve conflicts by newer files automatically.")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.resolveConflictsByNewerFile).onChange(async (value) => {
                    this.plugin.settings.resolveConflictsByNewerFile = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Postpone resolution of inactive files")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.checkConflictOnlyOnOpen).onChange(async (value) => {
                    this.plugin.settings.checkConflictOnlyOnOpen = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerSyncSettingEl)
            .setName("Postpone manual resolution of inactive files")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showMergeDialogOnlyOnActive).onChange(async (value) => {
                    this.plugin.settings.showMergeDialogOnlyOnActive = value;
                    await this.plugin.saveSettings();
                })
            );
        containerSyncSettingEl.createEl("h4", { text: "Compatibility" }).addClass("wizardHidden");
        new Setting(containerSyncSettingEl)
            .setName("Always resolve conflict manually")
            .setDesc("If this switch is turned on, a merge dialog will be displayed, even if the sensible-merge is possible automatically. (Turn on to previous behavior)")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.disableMarkdownAutoMerge).onChange(async (value) => {
                    this.plugin.settings.disableMarkdownAutoMerge = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerSyncSettingEl)
            .setName("Always reflect synchronized changes even if the note has a conflict")
            .setDesc("Turn on to previous behavior")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.writeDocumentsIfConflicted).onChange(async (value) => {
                    this.plugin.settings.writeDocumentsIfConflicted = value;
                    await this.plugin.saveSettings();
                })
            );

        containerSyncSettingEl.createEl("h4", { text: "Hidden files" }).addClass("wizardHidden");
        const LABEL_ENABLED = "🔁 : Enabled";
        const LABEL_DISABLED = "⏹️ : Disabled"

        const hiddenFileSyncSetting = new Setting(containerSyncSettingEl)
            .setName("Hidden file synchronization").setClass("wizardHidden")
        const hiddenFileSyncSettingEl = hiddenFileSyncSetting.settingEl
        const hiddenFileSyncSettingDiv = hiddenFileSyncSettingEl.createDiv("");
        hiddenFileSyncSettingDiv.innerText = this.plugin.settings.syncInternalFiles ? LABEL_ENABLED : LABEL_DISABLED;

        if (this.plugin.settings.syncInternalFiles) {
            new Setting(containerSyncSettingEl)
                .setName("Disable Hidden files sync")
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText("Disable")
                        .onClick(async () => {
                            this.plugin.settings.syncInternalFiles = false;
                            await this.plugin.saveSettings();
                            this.display();
                        })
                })
        } else {

            new Setting(containerSyncSettingEl)
                .setName("Enable Hidden files sync")
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText("Merge")
                        .onClick(async () => {
                            this.closeSetting()
                            await this.plugin.addOnSetup.configureHiddenFileSync("MERGE");
                        })
                })
                .addButton((button) => {
                    button.setButtonText("Fetch")
                        .onClick(async () => {
                            this.closeSetting()
                            await this.plugin.addOnSetup.configureHiddenFileSync("FETCH");
                        })
                })
                .addButton((button) => {
                    button.setButtonText("Overwrite")
                        .onClick(async () => {
                            this.closeSetting()
                            await this.plugin.addOnSetup.configureHiddenFileSync("OVERWRITE");
                        })
                });
        }

        if (!this.plugin.settings.watchInternalFileChanges) {
            new Setting(containerSyncSettingEl)
                .setName("Scan for hidden files before replication")
                .setClass("wizardHidden")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncInternalFilesBeforeReplication).onChange(async (value) => {
                        this.plugin.settings.syncInternalFilesBeforeReplication = value;
                        await this.plugin.saveSettings();
                    })
                );
        }
        new Setting(containerSyncSettingEl)
            .setName("Scan hidden files periodically")
            .setDesc("Seconds, 0 to disable")
            .setClass("wizardHidden")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.syncInternalFilesInterval + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (v !== 0 && (isNaN(v) || v < 10)) {
                            v = 10;
                        }
                        this.plugin.settings.syncInternalFilesInterval = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });
        let skipPatternTextArea: TextAreaComponent;
        const defaultSkipPattern = "\\/node_modules\\/, \\/\\.git\\/, \\/obsidian-livesync\\/";
        const defaultSkipPatternXPlat = defaultSkipPattern + ",\\/workspace$ ,\\/workspace.json$,\\/workspace-mobile.json$";
        new Setting(containerSyncSettingEl)
            .setName("Folders and files to ignore")
            .setDesc(
                "Regular expression, If you use hidden file sync between desktop and mobile, adding `workspace$` is recommended."
            )
            .setClass("wizardHidden")
            .addTextArea((text) => {
                text
                    .setValue(this.plugin.settings.syncInternalFilesIgnorePatterns)
                    .setPlaceholder("\\/node_modules\\/, \\/\\.git\\/")
                    .onChange(async (value) => {
                        this.plugin.settings.syncInternalFilesIgnorePatterns = value;
                        await this.plugin.saveSettings();
                    })
                skipPatternTextArea = text;
                return text;
            }
            );
        new Setting(containerSyncSettingEl)
            .setName("Restore the skip pattern to default")
            .setClass("wizardHidden")
            .addButton((button) => {
                button.setButtonText("Default")
                    .onClick(async () => {
                        skipPatternTextArea.setValue(defaultSkipPattern);
                        this.plugin.settings.syncInternalFilesIgnorePatterns = defaultSkipPattern;
                        await this.plugin.saveSettings();
                    })
            }).addButton((button) => {
                button.setButtonText("Cross-platform")
                    .onClick(async () => {
                        skipPatternTextArea.setValue(defaultSkipPatternXPlat);
                        this.plugin.settings.syncInternalFilesIgnorePatterns = defaultSkipPatternXPlat;
                        await this.plugin.saveSettings();
                    })
            })


        containerSyncSettingEl.createEl("h4", { text: "Performance tweaks" }).addClass("wizardHidden");
        new Setting(containerSyncSettingEl)
            .setName("Batch database update")
            .setDesc("Reducing the frequency with which on-disk changes are reflected into the DB")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.batchSave).onChange(async (value) => {
                    this.plugin.settings.batchSave = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerSyncSettingEl)
            .setName("Enhance chunk size")
            .setDesc("Enhance chunk size for binary files (Ratio). This cannot be increased when using IBM Cloudant.")
            .setClass("wizardHidden")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.customChunkSize + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 1) {
                            v = 0;
                        }
                        this.plugin.settings.customChunkSize = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        new Setting(containerSyncSettingEl)
            .setName("Fetch chunks on demand")
            .setDesc("(ex. Read chunks online) If this option is enabled, LiveSync reads chunks online directly instead of replicating them locally. Increasing Custom chunk size is recommended.")
            .setClass("wizardHidden")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.readChunksOnline)
                    .onChange(async (value) => {
                        this.plugin.settings.readChunksOnline = value;
                        await this.plugin.saveSettings();
                    })
                return toggle;
            });

        containerSyncSettingEl.createEl("h4", {
            text: sanitizeHTMLToDom(`Targets`),
        }).addClass("wizardHidden");
        new Setting(containerSyncSettingEl)
            .setName("Synchronising files")
            .setDesc("(RegExp) Empty to sync all files. set filter as a regular expression to limit synchronising files.")
            .setClass("wizardHidden")
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
            .setName("Non-Synchronising files")
            .setDesc("(RegExp) If this is set, any changes to local and remote files that match this will be skipped.")
            .setClass("wizardHidden")
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
            .setName("Maximum file size")
            .setDesc("(MB) If this is set, changes to local and remote files that are larger than this will be skipped. If the file becomes smaller again, a newer one will be used.")
            .setClass("wizardHidden")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.syncMaxSizeInMB + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 1) {
                            v = 0;
                        }
                        this.plugin.settings.syncMaxSizeInMB = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });
        new Setting(containerSyncSettingEl)
            .setName("(Beta) Use ignore files")
            .setDesc("If this is set, changes to local files which are matched by the ignore files will be skipped. Remote changes are determined using local ignore files.")
            .setClass("wizardHidden")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.useIgnoreFiles)
                    .onChange(async (value) => {
                        this.plugin.settings.useIgnoreFiles = value;
                        await this.plugin.saveSettings();
                        this.display();
                    })
                return toggle;
            }
            );
        if (this.plugin.settings.useIgnoreFiles) {
            new Setting(containerSyncSettingEl)
                .setName("Ignore files")
                .setDesc("We can use multiple ignore files, e.g.) `.gitignore, .dockerignore`")
                .setClass("wizardHidden")
                .addTextArea((text) => {
                    text
                        .setValue(this.plugin.settings.ignoreFiles)
                        .setPlaceholder(".gitignore, .dockerignore")
                        .onChange(async (value) => {
                            this.plugin.settings.ignoreFiles = value;
                            await this.plugin.saveSettings();
                        })
                    return text;
                }
                );
        }
        containerSyncSettingEl.createEl("h4", {
            text: sanitizeHTMLToDom(`Advanced settings`),
        }).addClass("wizardHidden");
        containerSyncSettingEl.createEl("div", {
            text: `If you reached the payload size limit when using IBM Cloudant, please decrease batch size and batch limit to a lower value.`,
        }).addClass("wizardHidden");
        new Setting(containerSyncSettingEl)
            .setName("Batch size")
            .setDesc("Number of change feed items to process at a time. Defaults to 50. Minimum is 2.")
            .setClass("wizardHidden")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.batch_size + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 2) {
                            v = 2;
                        }
                        this.plugin.settings.batch_size = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        new Setting(containerSyncSettingEl)
            .setName("Batch limit")
            .setDesc("Number of batches to process at a time. Defaults to 40. Minimum is 2. This along with batch size controls how many docs are kept in memory at a time.")
            .setClass("wizardHidden")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.batches_limit + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 2) {
                            v = 2;
                        }
                        this.plugin.settings.batches_limit = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        new Setting(containerSyncSettingEl)
            .setName("Use timeouts instead of heartbeats")
            .setDesc("If this option is enabled, PouchDB will hold the connection open for 60 seconds, and if no change arrives in that time, close and reopen the socket, instead of holding it open indefinitely. Useful when a proxy limits request duration but can increase resource usage.")
            .setClass("wizardHidden")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.useTimeouts)
                    .onChange(async (value) => {
                        this.plugin.settings.useTimeouts = value;
                        await this.plugin.saveSettings();
                    })
                return toggle;
            }
            );

        new Setting(containerSyncSettingEl)
            .setName("Batch size of on-demand fetching")
            .setDesc("")
            .setClass("wizardHidden")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.concurrencyOfReadChunksOnline + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10) {
                            v = 10;
                        }
                        this.plugin.settings.concurrencyOfReadChunksOnline = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });
        new Setting(containerSyncSettingEl)
            .setName("The delay for consecutive on-demand fetches")
            .setDesc("")
            .setClass("wizardHidden")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.minimumIntervalOfReadChunksOnline + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10) {
                            v = 10;
                        }
                        this.plugin.settings.minimumIntervalOfReadChunksOnline = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        addScreenElement("30", containerSyncSettingEl);
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
                        const scheme = pluginConfig.couchDB_URI.startsWith("http:") ? "(HTTP)" : (pluginConfig.couchDB_URI.startsWith("https:")) ? "(HTTPS)" : ""
                        pluginConfig.couchDB_URI = isCloudantURI(pluginConfig.couchDB_URI) ? "cloudant" : `self-hosted${scheme}`;
                        pluginConfig.couchDB_USER = REDACTED;
                        pluginConfig.passphrase = REDACTED;
                        pluginConfig.encryptedPassphrase = REDACTED;
                        pluginConfig.encryptedCouchDBConnection = REDACTED;
                        pluginConfig.pluginSyncExtendedSetting = {};
                        const obsidianInfo = navigator.userAgent;
                        const msgConfig = `---- Obsidian info ----
${obsidianInfo}
---- remote config ----
${stringifyYaml(responseConfig)}
---- Plug-in config ---
version:${manifestVersion}
${stringifyYaml(pluginConfig)}`;
                        console.log(msgConfig);
                        await navigator.clipboard.writeText(msgConfig);
                        Logger(`Information has been copied to clipboard`, LOG_LEVEL_NOTICE);
                    })
            );

        if (this.plugin.replicator.remoteLockedAndDeviceNotAccepted) {
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
            if (this.plugin.replicator.remoteLocked) {
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

        new Setting(containerHatchEl)
            .setName("Back to non-configured")
            .addButton((button) =>
                button
                    .setButtonText("Back")
                    .setDisabled(false)
                    .onClick(async () => {
                        this.plugin.settings.isConfigured = false;
                        await this.plugin.saveSettings();
                        this.askReload();
                    }));
        const hatchWarn = containerHatchEl.createEl("div", { text: `To stop the boot up sequence for fixing problems on databases, you can put redflag.md on top of your vault (Rebooting obsidian is required).` });
        hatchWarn.addClass("op-warn-info");



        const addResult = (path: string, file: TFile | false, fileOnDB: LoadedEntry | false) => {
            resultArea.appendChild(resultArea.createEl("div", {}, el => {
                el.appendChild(el.createEl("h6", { text: path }));
                el.appendChild(el.createEl("div", {}, infoGroupEl => {
                    infoGroupEl.appendChild(infoGroupEl.createEl("div", { text: `Storage : Modified: ${!file ? `Missing:` : `${new Date(file.stat.mtime).toLocaleString()}, Size:${file.stat.size}`}` }))
                    infoGroupEl.appendChild(infoGroupEl.createEl("div", { text: `Database: Modified: ${!fileOnDB ? `Missing:` : `${new Date(fileOnDB.mtime).toLocaleString()}, Size:${fileOnDB.size}`}` }))
                }));
                if (fileOnDB && file) {
                    el.appendChild(el.createEl("button", { text: "Show history" }, buttonEl => {
                        buttonEl.onClickEvent(() => {
                            this.plugin.showHistory(file, fileOnDB._id);
                        })
                    }))
                }
                if (file) {
                    el.appendChild(el.createEl("button", { text: "Storage -> Database" }, buttonEl => {
                        buttonEl.onClickEvent(() => {
                            this.plugin.updateIntoDB(file, undefined, true);
                            el.remove();
                        })
                    }))
                }
                if (fileOnDB) {
                    el.appendChild(el.createEl("button", { text: "Database -> Storage" }, buttonEl => {
                        buttonEl.onClickEvent(() => {
                            this.plugin.pullFile(this.plugin.getPath(fileOnDB), [], true, undefined, false);
                            el.remove();
                        })
                    }))
                }
                return el;
            }))
        }

        const checkBetweenStorageAndDatabase = async (file: TFile, fileOnDB: LoadedEntry) => {
            const dataContent = readAsBlob(fileOnDB);
            const content = createBlob(await this.plugin.vaultAccess.vaultReadAuto(file))
            if (await isDocContentSame(content, dataContent)) {
                Logger(`Compare: SAME: ${file.path}`)
            } else {
                Logger(`Compare: CONTENT IS NOT MATCHED! ${file.path}`, LOG_LEVEL_NOTICE);
                addResult(file.path, file, fileOnDB)
            }
        }
        new Setting(containerHatchEl)
            .setName("Verify and repair all files")
            .setDesc("Compare the content of files between on local database and storage. If not matched, you will asked which one want to keep.")
            .addButton((button) =>
                button
                    .setButtonText("Verify all")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        const files = this.app.vault.getFiles();
                        const documents = [] as FilePathWithPrefix[];

                        const adn = this.plugin.localDatabase.findAllNormalDocs()
                        for await (const i of adn) documents.push(this.plugin.getPath(i));
                        const allPaths = [...new Set([...documents, ...files.map(e => e.path as FilePathWithPrefix)])];
                        let i = 0;
                        for (const path of allPaths) {
                            i++;
                            Logger(`${i}/${files.length}\n${path}`, LOG_LEVEL_NOTICE, "verify");
                            if (shouldBeIgnored(path)) continue;
                            const abstractFile = this.plugin.vaultAccess.getAbstractFileByPath(path);
                            const fileOnStorage = abstractFile instanceof TFile ? abstractFile : false;
                            if (!await this.plugin.isTargetFile(path)) continue;

                            if (fileOnStorage && this.plugin.isFileSizeExceeded(fileOnStorage.stat.size)) continue;
                            const fileOnDB = await this.plugin.localDatabase.getDBEntry(path);
                            if (fileOnDB && this.plugin.isFileSizeExceeded(fileOnDB.size)) continue;

                            if (!fileOnDB && fileOnStorage) {
                                Logger(`Compare: Not found on the local database: ${path}`, LOG_LEVEL_NOTICE);
                                addResult(path, fileOnStorage, false)
                                continue;
                            }
                            if (fileOnDB && !fileOnStorage) {
                                Logger(`Compare: Not found on the storage: ${path}`, LOG_LEVEL_NOTICE);
                                addResult(path, false, fileOnDB)
                                continue;
                            }
                            if (fileOnStorage && fileOnDB) {
                                await checkBetweenStorageAndDatabase(fileOnStorage, fileOnDB)
                            }
                        }
                        Logger("done", LOG_LEVEL_NOTICE, "verify");
                    })
            );
        const resultArea = containerHatchEl.createDiv({ text: "" });
        new Setting(containerHatchEl)
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
                                const idEncoded = await this.plugin.path2id(docName as FilePathWithPrefix);
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
                                    const obfuscatedDoc = await this.plugin.localDatabase.getRaw(idEncoded, { revs_info: true });
                                    // Unfortunately we have to delete one of them.
                                    // Just now, save it as a conflicted document.
                                    obfuscatedDoc._revs_info?.shift(); // Drop latest revision.
                                    const previousRev = obfuscatedDoc._revs_info?.shift(); // Use second revision.
                                    if (previousRev) {
                                        newDoc._rev = previousRev.rev;
                                    } else {
                                        //If there are no revisions, set the possibly unique one
                                        newDoc._rev = "1-" + (`00000000000000000000000000000000${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}`.slice(-32));
                                    }
                                    const ret = await this.plugin.localDatabase.putRaw(newDoc, { force: true });
                                    if (ret.ok) {
                                        Logger(`${docName} has been converted as conflicted document`, LOG_LEVEL_NOTICE);
                                        doc._deleted = true;
                                        if ((await this.plugin.localDatabase.putRaw(doc)).ok) {
                                            Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                        }
                                        await this.plugin.queueConflictCheck(docName as FilePathWithPrefix);
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
                                        Logger(`Something went wrong on converting ${docName}`, LOG_LEVEL_NOTICE);
                                        Logger(ex, LOG_LEVEL_VERBOSE);
                                        // Something wrong.
                                    }
                                }
                            }
                        }
                        Logger(`Converting finished`, LOG_LEVEL_NOTICE);
                    }));

        new Setting(containerHatchEl)
            .setName("Delete all customization sync data")
            .addButton((button) =>
                button
                    .setButtonText("Delete")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        Logger(`Deleting customization sync data`, LOG_LEVEL_NOTICE);
                        const entriesToDelete = (await this.plugin.localDatabase.allDocsRaw({ startkey: "ix:", endkey: "ix:\u{10ffff}", include_docs: true }));
                        const newData = entriesToDelete.rows.map(e => ({ ...e.doc, _deleted: true }));
                        const r = await this.plugin.localDatabase.bulkDocsRaw(newData as any[]);
                        // Do not care about the result.
                        Logger(`${r.length} items have been removed, to confirm how many items are left, please perform it again.`, LOG_LEVEL_NOTICE);
                    }))
        new Setting(containerHatchEl)
            .setName("Suspend file watching")
            .setDesc("Stop watching for file change.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.suspendFileWatching).onChange(async (value) => {
                    this.plugin.settings.suspendFileWatching = value;
                    await this.plugin.saveSettings();
                    this.askReload();
                })
            );
        new Setting(containerHatchEl)
            .setName("Suspend database reflecting")
            .setDesc("Stop reflecting database changes to storage files.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.suspendParseReplicationResult).onChange(async (value) => {
                    this.plugin.settings.suspendParseReplicationResult = value;
                    await this.plugin.saveSettings();
                    this.askReload();
                })
            );
        new Setting(containerHatchEl)
            .setName("Write logs into the file")
            .setDesc("Warning! This will have a serious impact on performance. And the logs will not be synchronised under the default name. Please be careful with logs; they often contain your confidential information.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.writeLogToTheFile).onChange(async (value) => {
                    this.plugin.settings.writeLogToTheFile = value;
                    await this.plugin.saveSettings();
                })
            );

        // new Setting(containerHatchEl)
        //     .setName("Do not pace synchronization")
        //     .setDesc("If this toggle enabled, synchronisation will not be paced by queued entries. If synchronisation has been deadlocked, please make this enabled once.")
        //     .addToggle((toggle) =>
        //         toggle.setValue(this.plugin.settings.doNotPaceReplication).onChange(async (value) => {
        //             this.plugin.settings.doNotPaceReplication = value;
        //             await this.plugin.saveSettings();
        //         })
        //     );
        containerHatchEl.createEl("h4", {
            text: sanitizeHTMLToDom(`Compatibility`),
            cls: "wizardHidden"
        });

        new Setting(containerHatchEl)
            .setName("Do not keep metadata of deleted files.")
            .setClass("wizardHidden")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.deleteMetadataOfDeletedFiles).onChange(async (value) => {
                    this.plugin.settings.deleteMetadataOfDeletedFiles = value;
                    await this.plugin.saveSettings();
                    this.display();
                })
            }
            );

        if (this.plugin.settings.deleteMetadataOfDeletedFiles) {
            new Setting(containerHatchEl)
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
        }


        new Setting(containerHatchEl)
            .setName("Use an old adapter for compatibility")
            .setDesc("Before v0.17.16, we used an old adapter for the local database. Now the new adapter is preferred. However, it needs local database rebuilding. Please disable this toggle when you have enough time. If leave it enabled, also while fetching from the remote database, you will be asked to disable this.")
            .setClass("wizardHidden")
            .addToggle((toggle) =>
                toggle.setValue(!this.plugin.settings.useIndexedDBAdapter).onChange(async (value) => {
                    this.plugin.settings.useIndexedDBAdapter = !value;
                    await this.plugin.saveSettings();
                    await rebuildDB("localOnly");
                })
            );

        new Setting(containerHatchEl)
            .setName("Scan changes on customization sync")
            .setDesc("Do not use internal API")
            .addToggle((toggle) =>
                toggle.setValue(!this.plugin.settings.watchInternalFileChanges).onChange(async (value) => {
                    this.plugin.settings.watchInternalFileChanges = !value;
                    await this.plugin.saveSettings();
                })
            );

        let newDatabaseName = this.plugin.settings.additionalSuffixOfDatabaseName + "";
        new Setting(containerHatchEl)
            .setName("Database suffix")
            .setDesc("LiveSync could not handle multiple vaults which have same name without different prefix, This should be automatically configured.")
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
                            Logger("Suffix was not changed.", LOG_LEVEL_NOTICE);
                            return;
                        }
                        this.plugin.settings.additionalSuffixOfDatabaseName = newDatabaseName;
                        await this.plugin.saveSettings();
                        Logger("Suffix has been changed. Reopening database...", LOG_LEVEL_NOTICE);
                        await this.plugin.initializeDatabase();
                    })
            })

        new Setting(containerHatchEl)
            .setName("The Hash algorithm for chunk IDs")
            .setDesc("xxhash64 is the current default.")
            .setClass("wizardHidden")
            .addDropdown((dropdown) =>
                dropdown
                    .addOptions({ "": "Old Algorithm", "xxhash32": "xxhash32 (Fast)", "xxhash64": "xxhash64 (Fastest)", "sha1": "Fallback (Without WebAssembly)" } as Record<HashAlgorithm, string>)
                    .setValue(this.plugin.settings.hashAlg)
                    .onChange(async (value) => {
                        this.plugin.settings.hashAlg = value as HashAlgorithm;
                        await this.plugin.saveSettings();
                    })
            )
            .setClass("wizardHidden");


        new Setting(containerHatchEl)
            .setName("Fetch database with previous behaviour")
            .setDesc("")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.doNotSuspendOnFetching).onChange(async (value) => {
                    this.plugin.settings.doNotSuspendOnFetching = value;
                    await this.plugin.saveSettings();
                })
            );
        addScreenElement("50", containerHatchEl);


        // With great respect, thank you TfTHacker!
        // Refer: https://github.com/TfTHacker/obsidian42-brat/blob/main/src/features/BetaPlugins.ts
        const containerPluginSettings = containerEl.createDiv();
        containerPluginSettings.createEl("h3", { text: "Customization sync (beta)" });

        const vaultName = new Setting(containerPluginSettings)
            .setName("Device name")
            .setDesc("Unique name between all synchronized devices")
            .addText((text) => {
                text.setPlaceholder("desktop")
                    .setValue(this.plugin.deviceAndVaultName)
                    .onChange(async (value) => {
                        this.plugin.deviceAndVaultName = value;
                        await this.plugin.saveSettings();
                    });
                // text.inputEl.setAttribute("type", "password");
            });
        const updateDisabledOfDeviceAndVaultName = () => {
            vaultName.setDisabled(this.plugin.settings.usePluginSync);
            // vaultName.setTooltip(this.plugin.settings.autoSweepPlugins || this.plugin.settings.autoSweepPluginsPeriodic ? "You could not change when you enabling auto scan." : "");
        };
        updateDisabledOfDeviceAndVaultName();
        new Setting(containerPluginSettings).setName("Enable customization sync").addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.usePluginSync).onChange(async (value) => {
                if (value && this.plugin.deviceAndVaultName.trim() == "") {
                    Logger("We have to configure `Device name` to use this feature.", LOG_LEVEL_NOTICE);
                    toggle.setValue(false);
                    return false;
                }
                this.plugin.settings.usePluginSync = value;
                this.display();
                await this.plugin.saveSettings();
            })
        );

        if (this.plugin.settings.usePluginSync) {
            new Setting(containerPluginSettings)
                .setName("Scan customization automatically")
                .setDesc("Scan customization before replicating.")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.autoSweepPlugins).onChange(async (value) => {
                        this.plugin.settings.autoSweepPlugins = value;
                        updateDisabledOfDeviceAndVaultName();
                        await this.plugin.saveSettings();
                    })
                );

            if (!this.plugin.settings.watchInternalFileChanges) {
                new Setting(containerPluginSettings)
                    .setName("Scan customization periodically")
                    .setDesc("Scan customization every 1 minute.")
                    .addToggle((toggle) =>
                        toggle.setValue(this.plugin.settings.autoSweepPluginsPeriodic).onChange(async (value) => {
                            this.plugin.settings.autoSweepPluginsPeriodic = value;
                            updateDisabledOfDeviceAndVaultName();
                            await this.plugin.saveSettings();
                        })
                    );
            }

            new Setting(containerPluginSettings)
                .setName("Notify customized")
                .setDesc("Notify when other device has newly customized.")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.notifyPluginOrSettingUpdated).onChange(async (value) => {
                        this.plugin.settings.notifyPluginOrSettingUpdated = value;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerPluginSettings)
                .setName("Open")
                .setDesc("Open the dialog")
                .addButton((button) => {
                    button
                        .setButtonText("Open")
                        .setDisabled(false)
                        .onClick(() => {
                            this.plugin.addOnConfigSync.showPluginSyncModal();
                        });
                });
        }

        updateDisabledOfDeviceAndVaultName();

        addScreenElement("60", containerPluginSettings);

        const containerMaintenanceEl = containerEl.createDiv();

        containerMaintenanceEl.createEl("h3", { text: "Maintain databases" });

        containerMaintenanceEl.createEl("h4", { text: "The remote database" });

        new Setting(containerMaintenanceEl)
            .setName("Lock remote database")
            .setDesc("Lock remote database to prevent synchronization with other devices.")
            .addButton((button) =>
                button
                    .setButtonText("Lock")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.markRemoteLocked();
                    })
            );

        new Setting(containerMaintenanceEl)
            .setName("Overwrite remote database")
            .setDesc("Overwrite remote database with local DB and passphrase.")
            .addButton((button) =>
                button
                    .setButtonText("Send")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("remoteOnly");
                    })
            )


        containerMaintenanceEl.createEl("h4", { text: "The local database" });

        new Setting(containerMaintenanceEl)
            .setName("Fetch rebuilt DB")
            .setDesc("Restore or reconstruct local database from remote database.")
            .addButton((button) =>
                button
                    .setButtonText("Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("localOnly");
                    })
            )

        new Setting(containerMaintenanceEl)
            .setName("Fetch rebuilt DB (Save local documents before)")
            .setDesc("Restore or reconstruct local database from remote database but use local chunks.")
            .addButton((button) =>
                button
                    .setButtonText("Save and Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("localOnlyWithChunks");
                    })
            )

        new Setting(containerMaintenanceEl)
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

        containerMaintenanceEl.createEl("h4", { text: "Both databases" });

        new Setting(containerMaintenanceEl)
            .setName("(Beta2) Clean up databases")
            .setDesc("Delete unused chunks to shrink the database. This feature requires disabling 'Use an old adapter for compatibility'")
            .addButton((button) =>
                button.setButtonText("DryRun")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.dryRunGC();
                    })
            ).addButton((button) =>
                button.setButtonText("Perform cleaning")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        this.closeSetting()
                        await this.plugin.dbGC();
                    })
            );
        new Setting(containerMaintenanceEl)
            .setName("Rebuild everything")
            .setDesc("Rebuild local and remote database with local files.")
            .addButton((button) =>
                button
                    .setButtonText("Rebuild")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("rebuildBothByThisDevice");
                    })
            )
        applyDisplayEnabled();
        addScreenElement("70", containerMaintenanceEl);

        applyDisplayEnabled();
        if (this.selectedScreen == "") {
            if (lastVersion != this.plugin.settings.lastReadUpdates) {
                if (this.plugin.settings.isConfigured) {
                    changeDisplay("100");
                } else {
                    changeDisplay("110")
                }
            } else {
                if (isAnySyncEnabled()) {
                    changeDisplay("20");
                } else {
                    changeDisplay("110")
                }
            }
        } else {
            changeDisplay(this.selectedScreen);
        }
    }
}
