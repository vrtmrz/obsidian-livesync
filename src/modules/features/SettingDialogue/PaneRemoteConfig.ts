import { MarkdownRenderer } from "../../../deps.ts";
import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    PREFERRED_JOURNAL_SYNC,
    PREFERRED_SETTING_CLOUDANT,
    PREFERRED_SETTING_SELF_HOSTED,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
} from "../../../lib/src/common/types.ts";
import { parseHeaderValues } from "../../../lib/src/common/utils.ts";
import { LOG_LEVEL_INFO, Logger } from "../../../lib/src/common/logger.ts";
import { isCloudantURI } from "../../../lib/src/pouchdb/utils_couchdb.ts";
import { requestToCouchDBWithCredentials } from "../../../common/utils.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import { generateCredentialObject } from "../../../lib/src/replication/httplib.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { combineOnUpdate, visibleOnly } from "./SettingPane.ts";
import { getWebCrypto } from "../../../lib/src/mods.ts";
import { arrayBufferToBase64Single } from "../../../lib/src/string_and_binary/convert.ts";
export function paneRemoteConfig(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    let checkResultDiv: HTMLDivElement;
    const checkConfig = async (checkResultDiv: HTMLDivElement | undefined) => {
        Logger($msg("obsidianLiveSyncSettingTab.logCheckingDbConfig"), LOG_LEVEL_INFO);
        let isSuccessful = true;
        const emptyDiv = createDiv();
        emptyDiv.innerHTML = "<span></span>";
        checkResultDiv?.replaceChildren(...[emptyDiv]);
        const addResult = (msg: string, classes?: string[]) => {
            const tmpDiv = createDiv();
            tmpDiv.addClass("ob-btn-config-fix");
            if (classes) {
                tmpDiv.addClasses(classes);
            }
            tmpDiv.innerHTML = `${msg}`;
            checkResultDiv?.appendChild(tmpDiv);
        };
        try {
            if (isCloudantURI(this.editingSettings.couchDB_URI)) {
                Logger($msg("obsidianLiveSyncSettingTab.logCannotUseCloudant"), LOG_LEVEL_NOTICE);
                return;
            }
            // Tip: Add log for cloudant as Logger($msg("obsidianLiveSyncSettingTab.logServerConfigurationCheck"));
            const customHeaders = parseHeaderValues(this.editingSettings.couchDB_CustomHeaders);
            const credential = generateCredentialObject(this.editingSettings);
            const r = await requestToCouchDBWithCredentials(
                this.editingSettings.couchDB_URI,
                credential,
                window.origin,
                undefined,
                undefined,
                undefined,
                customHeaders
            );
            const responseConfig = r.json;

            const addConfigFixButton = (title: string, key: string, value: string) => {
                if (!checkResultDiv) return;
                const tmpDiv = createDiv();
                tmpDiv.addClass("ob-btn-config-fix");
                tmpDiv.innerHTML = `<label>${title}</label><button>${$msg("obsidianLiveSyncSettingTab.btnFix")}</button>`;
                const x = checkResultDiv.appendChild(tmpDiv);
                x.querySelector("button")?.addEventListener("click", () => {
                    fireAndForget(async () => {
                        Logger($msg("obsidianLiveSyncSettingTab.logCouchDbConfigSet", { title, key, value }));
                        const res = await requestToCouchDBWithCredentials(
                            this.editingSettings.couchDB_URI,
                            credential,
                            undefined,
                            key,
                            value,
                            undefined,
                            customHeaders
                        );
                        if (res.status == 200) {
                            Logger(
                                $msg("obsidianLiveSyncSettingTab.logCouchDbConfigUpdated", { title }),
                                LOG_LEVEL_NOTICE
                            );
                            checkResultDiv.removeChild(x);
                            await checkConfig(checkResultDiv);
                        } else {
                            Logger(
                                $msg("obsidianLiveSyncSettingTab.logCouchDbConfigFail", { title }),
                                LOG_LEVEL_NOTICE
                            );
                            Logger(res.text, LOG_LEVEL_VERBOSE);
                        }
                    });
                });
            };
            addResult($msg("obsidianLiveSyncSettingTab.msgNotice"), ["ob-btn-config-head"]);
            addResult($msg("obsidianLiveSyncSettingTab.msgIfConfigNotPersistent"), ["ob-btn-config-info"]);
            addResult($msg("obsidianLiveSyncSettingTab.msgConfigCheck"), ["ob-btn-config-head"]);

            const serverBanner = r.headers["server"] ?? r.headers["Server"] ?? "unknown";
            addResult($msg("obsidianLiveSyncSettingTab.serverVersion", { info: serverBanner }));
            const versionMatch = serverBanner.match(/CouchDB(\/([0-9.]+))?/);
            const versionStr = versionMatch ? versionMatch[2] : "0.0.0";
            const versionParts = `${versionStr}.0.0.0`.split(".");
            // Compare version string with the target version.
            // version must be a string like "3.2.1" or "3.10.2", and must be two or three parts.
            function isGreaterThanOrEqual(version: string) {
                const targetParts = version.split(".");
                for (let i = 0; i < targetParts.length; i++) {
                    // compare as number if possible (so 3.10 > 3.2, 3.10.1b > 3.10.1a)
                    const result = versionParts[i].localeCompare(targetParts[i], undefined, { numeric: true });
                    if (result > 0) return true;
                    if (result < 0) return false;
                }
                return true;
            }
            // Admin check
            //  for database creation and deletion
            if (!(this.editingSettings.couchDB_USER in responseConfig.admins)) {
                addResult($msg("obsidianLiveSyncSettingTab.warnNoAdmin"));
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okAdminPrivileges"));
            }
            if (isGreaterThanOrEqual("3.2.0")) {
                // HTTP user-authorization check
                if (responseConfig?.chttpd?.require_valid_user != "true") {
                    isSuccessful = false;
                    addResult($msg("obsidianLiveSyncSettingTab.errRequireValidUser"));
                    addConfigFixButton(
                        $msg("obsidianLiveSyncSettingTab.msgSetRequireValidUser"),
                        "chttpd/require_valid_user",
                        "true"
                    );
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okRequireValidUser"));
                }
            } else {
                if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                    isSuccessful = false;
                    addResult($msg("obsidianLiveSyncSettingTab.errRequireValidUserAuth"));
                    addConfigFixButton(
                        $msg("obsidianLiveSyncSettingTab.msgSetRequireValidUserAuth"),
                        "chttpd_auth/require_valid_user",
                        "true"
                    );
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okRequireValidUserAuth"));
                }
            }
            // HTTPD check
            //  Check Authentication header
            if (!responseConfig?.httpd["WWW-Authenticate"]) {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errMissingWwwAuth"));
                addConfigFixButton(
                    $msg("obsidianLiveSyncSettingTab.msgSetWwwAuth"),
                    "httpd/WWW-Authenticate",
                    'Basic realm="couchdb"'
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okWwwAuth"));
            }
            if (isGreaterThanOrEqual("3.2.0")) {
                if (responseConfig?.chttpd?.enable_cors != "true") {
                    isSuccessful = false;
                    addResult($msg("obsidianLiveSyncSettingTab.errEnableCorsChttpd"));
                    addConfigFixButton(
                        $msg("obsidianLiveSyncSettingTab.msgEnableCorsChttpd"),
                        "chttpd/enable_cors",
                        "true"
                    );
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okEnableCorsChttpd"));
                }
            } else {
                if (responseConfig?.httpd?.enable_cors != "true") {
                    isSuccessful = false;
                    addResult($msg("obsidianLiveSyncSettingTab.errEnableCors"));
                    addConfigFixButton($msg("obsidianLiveSyncSettingTab.msgEnableCors"), "httpd/enable_cors", "true");
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okEnableCors"));
                }
            }
            // If the server is not cloudant, configure request size
            if (!isCloudantURI(this.editingSettings.couchDB_URI)) {
                // REQUEST SIZE
                if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                    isSuccessful = false;
                    addResult($msg("obsidianLiveSyncSettingTab.errMaxRequestSize"));
                    addConfigFixButton(
                        $msg("obsidianLiveSyncSettingTab.msgSetMaxRequestSize"),
                        "chttpd/max_http_request_size",
                        "4294967296"
                    );
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okMaxRequestSize"));
                }
                if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                    isSuccessful = false;
                    addResult($msg("obsidianLiveSyncSettingTab.errMaxDocumentSize"));
                    addConfigFixButton(
                        $msg("obsidianLiveSyncSettingTab.msgSetMaxDocSize"),
                        "couchdb/max_document_size",
                        "50000000"
                    );
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okMaxDocumentSize"));
                }
            }
            // CORS check
            //  checking connectivity for mobile
            if (responseConfig?.cors?.credentials != "true") {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errCorsCredentials"));
                addConfigFixButton(
                    $msg("obsidianLiveSyncSettingTab.msgSetCorsCredentials"),
                    "cors/credentials",
                    "true"
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okCorsCredentials"));
            }
            const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
            if (
                responseConfig?.cors?.origins == "*" ||
                (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 &&
                    ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 &&
                    ConfiguredOrigins.indexOf("http://localhost") !== -1)
            ) {
                addResult($msg("obsidianLiveSyncSettingTab.okCorsOrigins"));
            } else {
                const fixedValue = [
                    ...new Set([
                        ...ConfiguredOrigins.map((e) => e.trim()),
                        "app://obsidian.md",
                        "capacitor://localhost",
                        "http://localhost",
                    ]),
                ].join(",");
                addResult($msg("obsidianLiveSyncSettingTab.errCorsOrigins"));
                addConfigFixButton($msg("obsidianLiveSyncSettingTab.msgSetCorsOrigins"), "cors/origins", fixedValue);
                isSuccessful = false;
            }
            addResult($msg("obsidianLiveSyncSettingTab.msgConnectionCheck"), ["ob-btn-config-head"]);
            addResult($msg("obsidianLiveSyncSettingTab.msgCurrentOrigin", { origin: window.location.origin }));

            // Request header check
            const origins = ["app://obsidian.md", "capacitor://localhost", "http://localhost"];
            for (const org of origins) {
                const rr = await requestToCouchDBWithCredentials(
                    this.editingSettings.couchDB_URI,
                    credential,
                    org,
                    undefined,
                    undefined,
                    undefined,
                    customHeaders
                );
                const responseHeaders = Object.fromEntries(
                    Object.entries(rr.headers).map((e) => {
                        e[0] = `${e[0]}`.toLowerCase();
                        return e;
                    })
                );
                addResult($msg("obsidianLiveSyncSettingTab.msgOriginCheck", { org }));
                if (responseHeaders["access-control-allow-credentials"] != "true") {
                    addResult($msg("obsidianLiveSyncSettingTab.errCorsNotAllowingCredentials"));
                    isSuccessful = false;
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okCorsCredentialsForOrigin"));
                }
                if (responseHeaders["access-control-allow-origin"] != org) {
                    addResult(
                        $msg("obsidianLiveSyncSettingTab.warnCorsOriginUnmatched", {
                            from: origin,
                            to: responseHeaders["access-control-allow-origin"],
                        })
                    );
                } else {
                    addResult($msg("obsidianLiveSyncSettingTab.okCorsOriginMatched"));
                }
            }
            addResult($msg("obsidianLiveSyncSettingTab.msgDone"), ["ob-btn-config-head"]);
            addResult($msg("obsidianLiveSyncSettingTab.msgConnectionProxyNote"), ["ob-btn-config-info"]);
            Logger($msg("obsidianLiveSyncSettingTab.logCheckingConfigDone"), LOG_LEVEL_INFO);
        } catch (ex: any) {
            if (ex?.status == 401) {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errAccessForbidden"));
                addResult($msg("obsidianLiveSyncSettingTab.errCannotContinueTest"));
                Logger($msg("obsidianLiveSyncSettingTab.logCheckingConfigDone"), LOG_LEVEL_INFO);
            } else {
                Logger($msg("obsidianLiveSyncSettingTab.logCheckingConfigFailed"), LOG_LEVEL_NOTICE);
                Logger(ex);
                isSuccessful = false;
            }
        }
        return isSuccessful;
    };
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleRemoteServer")).then((paneEl) => {
        // const containerRemoteDatabaseEl = containerEl.createDiv();
        this.createEl(
            paneEl,
            "div",
            {
                text: $msg("obsidianLiveSyncSettingTab.msgSettingsUnchangeableDuringSync"),
            },
            undefined,
            visibleOnly(() => this.isAnySyncEnabled())
        ).addClass("op-warn-info");
        new Setting(paneEl).autoWireDropDown("remoteType", {
            holdValue: true,
            options: {
                [REMOTE_COUCHDB]: $msg("obsidianLiveSyncSettingTab.optionCouchDB"),
                [REMOTE_MINIO]: $msg("obsidianLiveSyncSettingTab.optionMinioS3R2"),
                [REMOTE_P2P]: "Only Peer-to-Peer",
            },
            onUpdate: this.enableOnlySyncDisabled,
        });
        void addPanel(paneEl, "Peer-to-Peer", undefined, this.onlyOnOnlyP2P).then((paneEl) => {
            const syncWarnP2P = this.createEl(paneEl, "div", {
                text: "",
            });
            const p2pMessage = `This feature is a Work In Progress, and configurable on \`P2P Replicator\` Pane.
The pane also can be launched by \`P2P Replicator\` command from the Command Palette.
`;

            void MarkdownRenderer.render(this.plugin.app, p2pMessage, syncWarnP2P, "/", this.plugin);
            syncWarnP2P.addClass("op-warn-info");
            new Setting(paneEl).setName("Apply Settings").setClass("wizardHidden").addApplyButton(["remoteType"]);
            // .addOnUpdate(onlyOnMinIO);
            // new Setting(paneEl).addButton((button) =>
            //     button
            //         .setButtonText("Open P2P Replicator")
            //         .onClick(() => {
            //             const addOn = this.plugin.getAddOn<P2PReplicator>(P2PReplicator.name);
            //             void addOn?.openPane();
            //             this.closeSetting();
            //         })
            // );
        });
        void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleMinioS3R2"), undefined, this.onlyOnMinIO).then(
            (paneEl) => {
                const syncWarnMinio = this.createEl(paneEl, "div", {
                    text: "",
                });
                const ObjectStorageMessage = $msg("obsidianLiveSyncSettingTab.msgObjectStorageWarning");

                void MarkdownRenderer.render(this.plugin.app, ObjectStorageMessage, syncWarnMinio, "/", this.plugin);
                syncWarnMinio.addClass("op-warn-info");

                new Setting(paneEl).autoWireText("endpoint", { holdValue: true });
                new Setting(paneEl).autoWireToggle("forcePathStyle", { holdValue: true });
                new Setting(paneEl).autoWireText("accessKey", { holdValue: true });

                new Setting(paneEl).autoWireText("secretKey", {
                    holdValue: true,
                    isPassword: true,
                });

                new Setting(paneEl).autoWireText("region", { holdValue: true });

                new Setting(paneEl).autoWireText("bucket", { holdValue: true });
                new Setting(paneEl).autoWireText("bucketPrefix", {
                    holdValue: true,
                    placeHolder: "vaultname/",
                });

                new Setting(paneEl).autoWireToggle("useCustomRequestHandler", { holdValue: true });
                new Setting(paneEl).autoWireTextArea("bucketCustomHeaders", {
                    holdValue: true,
                    placeHolder: "x-custom-header: value\n x-custom-header2: value2",
                });
                new Setting(paneEl).setName($msg("obsidianLiveSyncSettingTab.nameTestConnection")).addButton((button) =>
                    button
                        .setButtonText($msg("obsidianLiveSyncSettingTab.btnTest"))
                        .setDisabled(false)
                        .onClick(async () => {
                            await this.testConnection(this.editingSettings);
                        })
                );
                new Setting(paneEl)
                    .setName($msg("obsidianLiveSyncSettingTab.nameApplySettings"))
                    .setClass("wizardHidden")
                    .addApplyButton([
                        "remoteType",
                        "endpoint",
                        "region",
                        "accessKey",
                        "secretKey",
                        "bucket",
                        "useCustomRequestHandler",
                        "bucketCustomHeaders",
                        "bucketPrefix",
                    ])
                    .addOnUpdate(this.onlyOnMinIO);
            }
        );

        void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleCouchDB"), undefined, this.onlyOnCouchDB).then(
            (paneEl) => {
                if (this.services.API.isMobile()) {
                    this.createEl(
                        paneEl,
                        "div",
                        {
                            text: $msg("obsidianLiveSyncSettingTab.msgNonHTTPSWarning"),
                        },
                        undefined,
                        visibleOnly(() => !this.editingSettings.couchDB_URI.startsWith("https://"))
                    ).addClass("op-warn");
                } else {
                    this.createEl(
                        paneEl,
                        "div",
                        {
                            text: $msg("obsidianLiveSyncSettingTab.msgNonHTTPSInfo"),
                        },
                        undefined,
                        visibleOnly(() => !this.editingSettings.couchDB_URI.startsWith("https://"))
                    ).addClass("op-warn-info");
                }

                new Setting(paneEl).autoWireText("couchDB_URI", {
                    holdValue: true,
                    onUpdate: this.enableOnlySyncDisabled,
                });
                new Setting(paneEl).autoWireToggle("useJWT", {
                    holdValue: true,
                    onUpdate: this.enableOnlySyncDisabled,
                });
                new Setting(paneEl).autoWireText("couchDB_USER", {
                    holdValue: true,
                    onUpdate: combineOnUpdate(
                        this.enableOnlySyncDisabled,
                        visibleOnly(() => !this.editingSettings.useJWT)
                    ),
                });
                new Setting(paneEl).autoWireText("couchDB_PASSWORD", {
                    holdValue: true,
                    isPassword: true,
                    onUpdate: combineOnUpdate(
                        this.enableOnlySyncDisabled,
                        visibleOnly(() => !this.editingSettings.useJWT)
                    ),
                });
                const algorithms = {
                    ["HS256"]: "HS256",
                    ["HS512"]: "HS512",
                    ["ES256"]: "ES256",
                    ["ES512"]: "ES512",
                } as const;
                new Setting(paneEl).autoWireDropDown("jwtAlgorithm", {
                    options: algorithms,
                    onUpdate: combineOnUpdate(
                        this.enableOnlySyncDisabled,
                        visibleOnly(() => this.editingSettings.useJWT)
                    ),
                });
                new Setting(paneEl).autoWireTextArea("jwtKey", {
                    holdValue: true,
                    onUpdate: combineOnUpdate(
                        this.enableOnlySyncDisabled,
                        visibleOnly(() => this.editingSettings.useJWT)
                    ),
                });
                // eslint-disable-next-line prefer-const
                let generatedKeyDivEl: HTMLDivElement;
                new Setting(paneEl)
                    .setDesc("Generate ES256 Keypair for testing")
                    .addButton((button) =>
                        button.setButtonText("Generate").onClick(async () => {
                            const crypto = await getWebCrypto();
                            const keyPair = await crypto.subtle.generateKey(
                                { name: "ECDSA", namedCurve: "P-256" },
                                true,
                                ["sign", "verify"]
                            );
                            const pubKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
                            const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
                            const encodedPublicKey = await arrayBufferToBase64Single(pubKey);
                            const encodedPrivateKey = await arrayBufferToBase64Single(privateKey);

                            const privateKeyPem = `> -----BEGIN PRIVATE KEY-----\n> ${encodedPrivateKey}\n> -----END PRIVATE KEY-----`;
                            const publicKeyPem = `> -----BEGIN PUBLIC KEY-----\\n${encodedPublicKey}\\n-----END PUBLIC KEY-----`;

                            const title = $msg("Setting.GenerateKeyPair.Title");
                            const msg = $msg("Setting.GenerateKeyPair.Desc", {
                                public_key: publicKeyPem,
                                private_key: privateKeyPem,
                            });
                            await MarkdownRenderer.render(
                                this.plugin.app,
                                "## " + title + "\n\n" + msg,
                                generatedKeyDivEl,
                                "/",
                                this.plugin
                            );
                        })
                    )
                    .addOnUpdate(
                        combineOnUpdate(
                            this.enableOnlySyncDisabled,
                            visibleOnly(() => this.editingSettings.useJWT)
                        )
                    );
                generatedKeyDivEl = this.createEl(
                    paneEl,
                    "div",
                    { text: "" },
                    (el) => {},
                    visibleOnly(() => this.editingSettings.useJWT)
                );

                new Setting(paneEl).autoWireText("jwtKid", {
                    holdValue: true,
                    onUpdate: combineOnUpdate(
                        this.enableOnlySyncDisabled,
                        visibleOnly(() => this.editingSettings.useJWT)
                    ),
                });
                new Setting(paneEl).autoWireText("jwtSub", {
                    holdValue: true,
                    onUpdate: combineOnUpdate(
                        this.enableOnlySyncDisabled,
                        visibleOnly(() => this.editingSettings.useJWT)
                    ),
                });
                new Setting(paneEl).autoWireNumeric("jwtExpDuration", {
                    holdValue: true,
                    onUpdate: combineOnUpdate(
                        this.enableOnlySyncDisabled,
                        visibleOnly(() => this.editingSettings.useJWT)
                    ),
                });
                new Setting(paneEl).autoWireText("couchDB_DBNAME", {
                    holdValue: true,
                    onUpdate: this.enableOnlySyncDisabled,
                });
                new Setting(paneEl).autoWireTextArea("couchDB_CustomHeaders", { holdValue: true });
                new Setting(paneEl).autoWireToggle("useRequestAPI", {
                    holdValue: true,
                    onUpdate: this.enableOnlySyncDisabled,
                });
                new Setting(paneEl)
                    .setName($msg("obsidianLiveSyncSettingTab.nameTestDatabaseConnection"))
                    .setClass("wizardHidden")
                    .setDesc($msg("obsidianLiveSyncSettingTab.descTestDatabaseConnection"))
                    .addButton((button) =>
                        button
                            .setButtonText($msg("obsidianLiveSyncSettingTab.btnTest"))
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.testConnection();
                            })
                    );

                new Setting(paneEl)
                    .setName($msg("obsidianLiveSyncSettingTab.nameValidateDatabaseConfig"))
                    .setDesc($msg("obsidianLiveSyncSettingTab.descValidateDatabaseConfig"))
                    .addButton((button) =>
                        button
                            .setButtonText($msg("obsidianLiveSyncSettingTab.btnCheck"))
                            .setDisabled(false)
                            .onClick(async () => {
                                await checkConfig(checkResultDiv);
                            })
                    );
                checkResultDiv = this.createEl(paneEl, "div", {
                    text: "",
                });

                new Setting(paneEl)
                    .setName($msg("obsidianLiveSyncSettingTab.nameApplySettings"))
                    .setClass("wizardHidden")
                    .addApplyButton([
                        "remoteType",
                        "couchDB_URI",
                        "couchDB_USER",
                        "couchDB_PASSWORD",
                        "couchDB_DBNAME",
                        "jwtAlgorithm",
                        "jwtExpDuration",
                        "jwtKey",
                        "jwtSub",
                        "jwtKid",
                        "useJWT",
                        "couchDB_CustomHeaders",
                        "useRequestAPI",
                    ])
                    .addOnUpdate(this.onlyOnCouchDB);
            }
        );
    });
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleNotification"), () => {}, this.onlyOnCouchDB).then(
        (paneEl) => {
            paneEl.addClass("wizardHidden");
            new Setting(paneEl).autoWireNumeric("notifyThresholdOfRemoteStorageSize", {}).setClass("wizardHidden");
        }
    );

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.panelPrivacyEncryption")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("encrypt", { holdValue: true });

        const isEncryptEnabled = visibleOnly(() => this.isConfiguredAs("encrypt", true));

        new Setting(paneEl).autoWireText("passphrase", {
            holdValue: true,
            isPassword: true,
            onUpdate: isEncryptEnabled,
        });

        new Setting(paneEl).autoWireToggle("usePathObfuscation", {
            holdValue: true,
            onUpdate: isEncryptEnabled,
        });
    });

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleFetchSettings")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.titleFetchConfigFromRemote"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descFetchConfigFromRemote"))
            .addButton((button) =>
                button
                    .setButtonText($msg("obsidianLiveSyncSettingTab.buttonFetch"))
                    .setDisabled(false)
                    .onClick(async () => {
                        const trialSetting = { ...this.initialSettings, ...this.editingSettings };
                        const newTweaks =
                            await this.services.tweakValue.checkAndAskUseRemoteConfiguration(trialSetting);
                        if (newTweaks.result !== false) {
                            if (this.inWizard) {
                                this.editingSettings = { ...this.editingSettings, ...newTweaks.result };
                                this.requestUpdate();
                                return;
                            } else {
                                this.closeSetting();
                                this.plugin.settings = { ...this.plugin.settings, ...newTweaks.result };
                                if (newTweaks.requireFetch) {
                                    if (
                                        (await this.plugin.confirm.askYesNoDialog(
                                            $msg("SettingTab.Message.AskRebuild"),
                                            {
                                                defaultOption: "Yes",
                                            }
                                        )) == "no"
                                    ) {
                                        await this.services.setting.saveSettingData();
                                        return;
                                    }
                                    await this.services.setting.saveSettingData();
                                    await this.plugin.rebuilder.scheduleFetch();
                                    this.services.appLifecycle.scheduleRestart();
                                    return;
                                } else {
                                    await this.services.setting.saveSettingData();
                                }
                            }
                        }
                    })
            );
    });
    new Setting(paneEl).setClass("wizardOnly").addButton((button) =>
        button
            .setButtonText($msg("obsidianLiveSyncSettingTab.buttonNext"))
            .setCta()
            .setDisabled(false)
            .onClick(async () => {
                if (!(await checkConfig(checkResultDiv))) {
                    if (
                        (await this.plugin.confirm.askYesNoDialog(
                            $msg("obsidianLiveSyncSettingTab.msgConfigCheckFailed"),
                            {
                                defaultOption: "No",
                                title: $msg("obsidianLiveSyncSettingTab.titleRemoteConfigCheckFailed"),
                            }
                        )) == "no"
                    ) {
                        return;
                    }
                }
                const isEncryptionFullyEnabled =
                    !this.editingSettings.encrypt || !this.editingSettings.usePathObfuscation;
                if (isEncryptionFullyEnabled) {
                    if (
                        (await this.plugin.confirm.askYesNoDialog(
                            $msg("obsidianLiveSyncSettingTab.msgEnableEncryptionRecommendation"),
                            {
                                defaultOption: "No",
                                title: $msg("obsidianLiveSyncSettingTab.titleEncryptionNotEnabled"),
                            }
                        )) == "no"
                    ) {
                        return;
                    }
                }
                if (!this.editingSettings.encrypt) {
                    this.editingSettings.passphrase = "";
                }
                if (!(await this.isPassphraseValid())) {
                    if (
                        (await this.plugin.confirm.askYesNoDialog(
                            $msg("obsidianLiveSyncSettingTab.msgInvalidPassphrase"),
                            {
                                defaultOption: "No",
                                title: $msg("obsidianLiveSyncSettingTab.titleEncryptionPassphraseInvalid"),
                            }
                        )) == "no"
                    ) {
                        return;
                    }
                }
                if (isCloudantURI(this.editingSettings.couchDB_URI)) {
                    this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_CLOUDANT };
                } else if (this.editingSettings.remoteType == REMOTE_MINIO) {
                    this.editingSettings = { ...this.editingSettings, ...PREFERRED_JOURNAL_SYNC };
                } else {
                    this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_SELF_HOSTED };
                }
                if (
                    (await this.plugin.confirm.askYesNoDialog(
                        $msg("obsidianLiveSyncSettingTab.msgFetchConfigFromRemote"),
                        { defaultOption: "Yes", title: $msg("obsidianLiveSyncSettingTab.titleFetchConfig") }
                    )) == "yes"
                ) {
                    const trialSetting = { ...this.initialSettings, ...this.editingSettings };
                    const newTweaks = await this.services.tweakValue.checkAndAskUseRemoteConfiguration(trialSetting);
                    if (newTweaks.result !== false) {
                        this.editingSettings = { ...this.editingSettings, ...newTweaks.result };
                        this.requestUpdate();
                    } else {
                        // Messages should be already shown.
                    }
                }
                this.changeDisplay("30");
            })
    );
}
