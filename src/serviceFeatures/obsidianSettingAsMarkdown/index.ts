import { isObjectDifferent } from "octagonal-wheels/object";
import { EVENT_SETTING_SAVED, eventHub } from "@/common/events.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import { DEFAULT_SETTINGS, type FilePathWithPrefix, type ObsidianLiveSyncSettings } from "@lib/common/types.ts";
import { parseYaml, stringifyYaml } from "@/deps.ts";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import { type LogFunction } from "@lib/services/lib/logUtils.ts";

export const SETTING_HEADER = "````yaml:livesync-setting\n";
export const SETTING_FOOTER = "\n````";

/**
 * Extracts the YAML settings block from the full text of a markdown file.
 *
 * Returns the preamble (text before the block), the body (YAML content), and
 * the postscript (text after the block). If no block is found, the entire
 * `data` string is returned as the preamble with empty body and postscript.
 */
export const extractSettingFromWholeText = (
    data: string
): {
    preamble: string;
    body: string;
    postscript: string;
} => {
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
    return {
        preamble: data.substring(0, dataStartPos),
        body,
        postscript: data.substring(dataEndPos + SETTING_FOOTER.length + 1),
    };
};

/**
 * Strips sensitive / internal-only fields from a settings snapshot so that it
 * is safe to serialise into a markdown file.
 *
 * If `keepCredential` is true (or `writeCredentialsForSettingSync` is set on
 * the settings object) the credential fields are retained; otherwise they are
 * removed.
 */
export const generateSettingForMarkdownPure = (
    settings: ObsidianLiveSyncSettings,
    keepCredential?: boolean
): Partial<ObsidianLiveSyncSettings> => {
    const saveData = { ...settings } as Partial<ObsidianLiveSyncSettings>;
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
};

/**
 * Obsidian Settings as Markdown Feature
 *
 * Allows saving and loading settings to/from a markdown file.
 */
export const useObsidianSettingAsMarkdownFeature = createObsidianServiceFeature<
    "appLifecycle" | "API" | "setting" | "UI",
    "storageAccess" | "rebuilder",
    "plugin"
>((host) => {
    const services = host.services;
    const context = host.context;
    const serviceModules = host.serviceModules;
    const log: LogFunction = createInstanceLogFunction("SettingAsMarkdown", services.API);

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    const generateSettingForMarkdown = (
        settings?: ObsidianLiveSyncSettings,
        keepCredential?: boolean
    ): Partial<ObsidianLiveSyncSettings> => {
        return generateSettingForMarkdownPure(settings ?? services.setting.settings, keepCredential);
    };

    const parseSettingFromMarkdown = async (filename: string, data?: string) => {
        const file = await serviceModules.storageAccess.isExists(filename);
        if (!file)
            return {
                preamble: "",
                body: "",
                postscript: "",
            };
        if (data) {
            return extractSettingFromWholeText(data);
        }
        const parseData = data ?? (await serviceModules.storageAccess.readFileText(filename));
        return extractSettingFromWholeText(parseData);
    };

    const saveSettingToMarkdown = async (filename: string) => {
        const saveData = generateSettingForMarkdown();
        const file = await serviceModules.storageAccess.isExists(filename);

        if (!file) {
            await serviceModules.storageAccess.ensureDir(filename);
            const initialContent = `This file contains Self-hosted LiveSync settings as YAML.
Except for the \`livesync-setting\` code block, we can add a note for free.

If the name of this file matches the value of the "settingSyncFile" setting inside the \`livesync-setting\` block, LiveSync will tell us whenever the settings change. We can decide to accept or decline the remote setting. (In other words, we can back up this file by renaming it to another name).

We can perform a command in this file.
- \`Parse setting file\` : load the setting from the file.

**Note** Please handle it with all of your care if you have configured to write credentials in.


`;
            await serviceModules.storageAccess.writeFileAuto(
                filename,
                initialContent + SETTING_HEADER + "\n" + SETTING_FOOTER
            );
        }

        const data = await serviceModules.storageAccess.readFileText(filename);
        const { preamble, body, postscript } = extractSettingFromWholeText(data);
        const newBody = stringifyYaml(saveData);

        if (newBody == body) {
            log("Markdown setting: Nothing had been changed", LOG_LEVEL_VERBOSE);
        } else {
            await serviceModules.storageAccess.writeFileAuto(
                filename,
                preamble + SETTING_HEADER + newBody + SETTING_FOOTER + postscript
            );
            log(`Markdown setting: ${filename} has been updated!`, LOG_LEVEL_VERBOSE);
        }
    };

    const checkAndApplySettingFromMarkdown = async (filename: string, automated?: boolean) => {
        if (automated && !services.setting.settings.notifyAllSettingSyncFile) {
            if (!services.setting.settings.settingSyncFile || services.setting.settings.settingSyncFile != filename) {
                log(`Setting file (${filename}) does not match the current configuration. skipped.`, LOG_LEVEL_DEBUG);
                return;
            }
        }
        const { body } = await parseSettingFromMarkdown(filename);
        let newSetting = {} as Partial<ObsidianLiveSyncSettings>;
        try {
            newSetting = parseYaml(body);
        } catch (ex) {
            log("Could not parse YAML", LOG_LEVEL_NOTICE);
            log(ex, LOG_LEVEL_VERBOSE);
            return;
        }

        if ("settingSyncFile" in newSetting && newSetting.settingSyncFile != filename) {
            log(
                "This setting file seems to backed up one. Please fix the filename or settingSyncFile value.",
                automated ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE
            );
            return;
        }

        let settingToApply = { ...DEFAULT_SETTINGS } as ObsidianLiveSyncSettings;
        settingToApply = { ...settingToApply, ...newSetting };
        if (!settingToApply?.writeCredentialsForSettingSync) {
            //New setting does not contains credentials.
            settingToApply.couchDB_USER = services.setting.settings.couchDB_USER;
            settingToApply.couchDB_PASSWORD = services.setting.settings.couchDB_PASSWORD;
            settingToApply.passphrase = services.setting.settings.passphrase;
        }
        const oldSetting = generateSettingForMarkdown(
            services.setting.settings,
            settingToApply.writeCredentialsForSettingSync
        );
        if (!isObjectDifferent(oldSetting, generateSettingForMarkdown(settingToApply))) {
            log("Setting markdown has been detected, but not changed.", automated ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE);
            return;
        }
        const addMsg = services.setting.settings.settingSyncFile != filename ? " (This is not-active file)" : "";
        services.UI.confirm.askInPopup(
            "apply-setting-from-md",
            `Setting markdown ${filename}${addMsg} has been detected. Apply this from {HERE}.`,
            (anchor: any) => {
                anchor.text = "HERE";
                anchor.addEventListener("click", () => {
                    fireAndForget(async () => {
                        const APPLY_ONLY = "Apply settings";
                        const APPLY_AND_RESTART = "Apply settings and restart obsidian";
                        const APPLY_AND_REBUILD = "Apply settings and restart obsidian with red_flag_rebuild.md";
                        const APPLY_AND_FETCH = "Apply settings and restart obsidian with red_flag_fetch.md";
                        const CANCEL = "Cancel";
                        const result = await services.UI.confirm.askSelectStringDialogue(
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
                            await services.setting.applyExternalSettings(newSetting, true);
                            services.setting.clearUsedPassphrase();
                            if (result == APPLY_ONLY) {
                                log("Loaded settings have been applied!", LOG_LEVEL_NOTICE);
                                return;
                            }
                            if (result == APPLY_AND_REBUILD) {
                                await serviceModules.rebuilder.scheduleRebuild();
                            }
                            if (result == APPLY_AND_FETCH) {
                                await serviceModules.rebuilder.scheduleFetch();
                            }
                            services.appLifecycle.performRestart();
                        }
                    });
                });
            }
        );
    };

    // -------------------------------------------------------------------------
    // Setup Handlers & Commands
    // -------------------------------------------------------------------------

    const setupSettingAsMarkdown = async () => {
        context.plugin.addCommand({
            id: "livesync-export-config",
            name: "Write setting markdown manually",
            checkCallback: (checking: boolean) => {
                if (checking) {
                    return services.setting.settings.settingSyncFile != "";
                }
                fireAndForget(async () => {
                    await services.setting.saveSettingData();
                });
            },
        });

        context.plugin.addCommand({
            id: "livesync-import-config",
            name: "Parse setting file",
            editorCheckCallback: (checking: boolean, editor: any, ctx: any) => {
                if (checking) {
                    const doc = editor.getValue();
                    const ret = extractSettingFromWholeText(doc);
                    return ret.body != "";
                }
                if (ctx.file) {
                    const file = ctx.file;
                    fireAndForget(async () => await checkAndApplySettingFromMarkdown(file.path, false));
                }
            },
        });

        eventHub.onEvent("event-file-changed", (info: { file: FilePathWithPrefix; automated: boolean }) => {
            fireAndForget(() => checkAndApplySettingFromMarkdown(info.file, info.automated));
        });

        eventHub.onEvent(EVENT_SETTING_SAVED, (settings: ObsidianLiveSyncSettings) => {
            if (settings.settingSyncFile != "") {
                fireAndForget(() => saveSettingToMarkdown(settings.settingSyncFile));
            }
        });

        return Promise.resolve(true);
    };

    services.appLifecycle.onInitialise.addHandler(setupSettingAsMarkdown);

    return {};
});
