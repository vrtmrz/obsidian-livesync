import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { isObjectDifferent } from "octagonal-wheels/object";
import { EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import { fireAndForget } from "octagonal-wheels/promises";
import { DEFAULT_SETTINGS, type FilePathWithPrefix, type ObsidianLiveSyncSettings } from "../../lib/src/common/types";
import { parseYaml, stringifyYaml } from "../../deps";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
const SETTING_HEADER = "````yaml:livesync-setting\n";
const SETTING_FOOTER = "\n````";
export class ModuleObsidianSettingsAsMarkdown extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        this.addCommand({
            id: "livesync-export-config",
            name: "Write setting markdown manually",
            checkCallback: (checking) => {
                if (checking) {
                    return this.settings.settingSyncFile != "";
                }
                fireAndForget(async () => {
                    await this.services.setting.saveSettingData();
                });
            },
        });
        this.addCommand({
            id: "livesync-import-config",
            name: "Parse setting file",
            editorCheckCallback: (checking, editor, ctx) => {
                if (checking) {
                    const doc = editor.getValue();
                    const ret = this.extractSettingFromWholeText(doc);
                    return ret.body != "";
                }
                if (ctx.file) {
                    const file = ctx.file;
                    fireAndForget(async () => await this.checkAndApplySettingFromMarkdown(file.path, false));
                }
            },
        });
        eventHub.onEvent("event-file-changed", (info: { file: FilePathWithPrefix; automated: boolean }) => {
            fireAndForget(() => this.checkAndApplySettingFromMarkdown(info.file, info.automated));
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (settings: ObsidianLiveSyncSettings) => {
            if (settings.settingSyncFile != "") {
                fireAndForget(() => this.saveSettingToMarkdown(settings.settingSyncFile));
            }
        });
        return Promise.resolve(true);
    }

    extractSettingFromWholeText(data: string): {
        preamble: string;
        body: string;
        postscript: string;
    } {
        if (data.indexOf(SETTING_HEADER) === -1) {
            return {
                preamble: data,
                body: "",
                postscript: "",
            };
        }
        const startMarkerPos = data.indexOf(SETTING_HEADER);
        const dataStartPos = startMarkerPos == -1 ? data.length : startMarkerPos;
        const endMarkerPos = startMarkerPos == -1 ? data.length : data.indexOf(SETTING_FOOTER, dataStartPos);
        const dataEndPos = endMarkerPos == -1 ? data.length : endMarkerPos;
        const body = data.substring(dataStartPos + SETTING_HEADER.length, dataEndPos);
        const ret = {
            preamble: data.substring(0, dataStartPos),
            body,
            postscript: data.substring(dataEndPos + SETTING_FOOTER.length + 1),
        };
        return ret;
    }

    async parseSettingFromMarkdown(filename: string, data?: string) {
        const file = await this.core.storageAccess.isExists(filename);
        if (!file)
            return {
                preamble: "",
                body: "",
                postscript: "",
            };
        if (data) {
            return this.extractSettingFromWholeText(data);
        }
        const parseData = data ?? (await this.core.storageAccess.readFileText(filename));
        return this.extractSettingFromWholeText(parseData);
    }

    async checkAndApplySettingFromMarkdown(filename: string, automated?: boolean) {
        if (automated && !this.settings.notifyAllSettingSyncFile) {
            if (!this.settings.settingSyncFile || this.settings.settingSyncFile != filename) {
                this._log(
                    `Setting file (${filename}) does not match the current configuration. skipped.`,
                    LOG_LEVEL_DEBUG
                );
                return;
            }
        }
        const { body } = await this.parseSettingFromMarkdown(filename);
        let newSetting = {} as Partial<ObsidianLiveSyncSettings>;
        try {
            newSetting = parseYaml(body);
        } catch (ex) {
            this._log("Could not parse YAML", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return;
        }

        if ("settingSyncFile" in newSetting && newSetting.settingSyncFile != filename) {
            this._log(
                "This setting file seems to backed up one. Please fix the filename or settingSyncFile value.",
                automated ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE
            );
            return;
        }

        let settingToApply = { ...DEFAULT_SETTINGS } as ObsidianLiveSyncSettings;
        settingToApply = { ...settingToApply, ...newSetting };
        if (!settingToApply?.writeCredentialsForSettingSync) {
            //New setting does not contains credentials.
            settingToApply.couchDB_USER = this.settings.couchDB_USER;
            settingToApply.couchDB_PASSWORD = this.settings.couchDB_PASSWORD;
            settingToApply.passphrase = this.settings.passphrase;
        }
        const oldSetting = this.generateSettingForMarkdown(
            this.settings,
            settingToApply.writeCredentialsForSettingSync
        );
        if (!isObjectDifferent(oldSetting, this.generateSettingForMarkdown(settingToApply))) {
            this._log(
                "Setting markdown has been detected, but not changed.",
                automated ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE
            );
            return;
        }
        const addMsg = this.settings.settingSyncFile != filename ? " (This is not-active file)" : "";
        this.core.confirm.askInPopup(
            "apply-setting-from-md",
            `Setting markdown ${filename}${addMsg} has been detected. Apply this from {HERE}.`,
            (anchor) => {
                anchor.text = "HERE";
                anchor.addEventListener("click", () => {
                    fireAndForget(async () => {
                        const APPLY_ONLY = "Apply settings";
                        const APPLY_AND_RESTART = "Apply settings and restart obsidian";
                        const APPLY_AND_REBUILD = "Apply settings and restart obsidian with red_flag_rebuild.md";
                        const APPLY_AND_FETCH = "Apply settings and restart obsidian with red_flag_fetch.md";
                        const CANCEL = "Cancel";
                        const result = await this.core.confirm.askSelectStringDialogue(
                            "Ready for apply the setting.",
                            [APPLY_AND_RESTART, APPLY_ONLY, APPLY_AND_FETCH, APPLY_AND_REBUILD, CANCEL],
                            { defaultAction: APPLY_AND_RESTART }
                        );
                        if (
                            result == APPLY_ONLY ||
                            result == APPLY_AND_RESTART ||
                            result == APPLY_AND_REBUILD ||
                            result == APPLY_AND_FETCH
                        ) {
                            this.core.settings = settingToApply;
                            await this.services.setting.saveSettingData();
                            if (result == APPLY_ONLY) {
                                this._log("Loaded settings have been applied!", LOG_LEVEL_NOTICE);
                                return;
                            }
                            if (result == APPLY_AND_REBUILD) {
                                await this.core.rebuilder.scheduleRebuild();
                            }
                            if (result == APPLY_AND_FETCH) {
                                await this.core.rebuilder.scheduleFetch();
                            }
                            this.services.appLifecycle.performRestart();
                        }
                    });
                });
            }
        );
    }

    generateSettingForMarkdown(
        settings?: ObsidianLiveSyncSettings,
        keepCredential?: boolean
    ): Partial<ObsidianLiveSyncSettings> {
        const saveData = { ...(settings ? settings : this.settings) } as Partial<ObsidianLiveSyncSettings>;
        delete saveData.encryptedCouchDBConnection;
        delete saveData.encryptedPassphrase;
        delete saveData.additionalSuffixOfDatabaseName;
        if (!saveData.writeCredentialsForSettingSync && !keepCredential) {
            delete saveData.couchDB_USER;
            delete saveData.couchDB_PASSWORD;
            delete saveData.passphrase;
            delete saveData.jwtKey;
            delete saveData.jwtKid;
            delete saveData.jwtSub;
            delete saveData.couchDB_CustomHeaders;
            delete saveData.bucketCustomHeaders;
        }
        return saveData;
    }

    async saveSettingToMarkdown(filename: string) {
        const saveData = this.generateSettingForMarkdown();
        const file = await this.core.storageAccess.isExists(filename);

        if (!file) {
            await this.core.storageAccess.ensureDir(filename);
            const initialContent = `This file contains Self-hosted LiveSync settings as YAML.
Except for the \`livesync-setting\` code block, we can add a note for free.

If the name of this file matches the value of the "settingSyncFile" setting inside the \`livesync-setting\` block, LiveSync will tell us whenever the settings change. We can decide to accept or decline the remote setting. (In other words, we can back up this file by renaming it to another name).

We can perform a command in this file.
- \`Parse setting file\` : load the setting from the file.

**Note** Please handle it with all of your care if you have configured to write credentials in.


`;
            await this.core.storageAccess.writeFileAuto(
                filename,
                initialContent + SETTING_HEADER + "\n" + SETTING_FOOTER
            );
        }
        // if (!(file instanceof TFile)) {
        //     this._log(`Markdown Setting: ${filename} already exists as a folder`, LOG_LEVEL_NOTICE);
        //     return;
        // }

        const data = await this.core.storageAccess.readFileText(filename);
        const { preamble, body, postscript } = this.extractSettingFromWholeText(data);
        const newBody = stringifyYaml(saveData);

        if (newBody == body) {
            this._log("Markdown setting: Nothing had been changed", LOG_LEVEL_VERBOSE);
        } else {
            await this.core.storageAccess.writeFileAuto(
                filename,
                preamble + SETTING_HEADER + newBody + SETTING_FOOTER + postscript
            );
            this._log(`Markdown setting: ${filename} has been updated!`, LOG_LEVEL_VERBOSE);
        }
    }
    onBindFunction(core: typeof this.plugin, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
    }
}
