import { $msg, $t } from "@/common/translation";
import { SUPPORTED_I18N_LANGS } from "@/common/rosetta";
import { NetworkWarningStyles } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import type { SettingSpecGroup } from "./SettingSpec.ts";

export type GeneralSettingSpecContext = {
    showEditorStatusDetails: () => boolean;
    showVerboseLog: () => boolean;
};

/** Build the shared Appearance and Logging controls. */
export function createGeneralSettingSpecGroups({
    showEditorStatusDetails,
    showVerboseLog,
}: GeneralSettingSpecContext): readonly SettingSpecGroup[] {
    return [
        {
            heading: $msg("obsidianLiveSyncSettingTab.titleAppearance"),
            items: [
                {
                    key: "displayLanguage",
                    control: {
                        type: "dropdown",
                        options: () =>
                            Object.fromEntries(
                                SUPPORTED_I18N_LANGS.map((language) => [language, $t(`lang-${language}`)])
                            ),
                    },
                },
                { key: "showStatusOnEditor", control: { type: "toggle" } },
                {
                    key: "showOnlyIconsOnEditor",
                    control: { type: "toggle" },
                    visible: showEditorStatusDetails,
                },
                { key: "showStatusOnStatusbar", control: { type: "toggle" } },
                { key: "hideFileWarningNotice", control: { type: "toggle" } },
                {
                    key: "networkWarningStyle",
                    control: {
                        type: "dropdown",
                        options: () => ({
                            [NetworkWarningStyles.BANNER]: "Show full banner",
                            [NetworkWarningStyles.ICON]: "Show icon only",
                            [NetworkWarningStyles.HIDDEN]: "Hide completely",
                        }),
                    },
                },
            ],
        },
        {
            heading: $msg("obsidianLiveSyncSettingTab.titleLogging"),
            items: [
                { key: "lessInformationInLog", control: { type: "toggle" } },
                {
                    key: "showVerboseLog",
                    control: { type: "toggle" },
                    visible: showVerboseLog,
                },
            ],
        },
    ];
}

/** Build the feature-level controls shown in General Settings under Extra menus. */
export function createExtraMenuSettingSpecGroup(): SettingSpecGroup {
    return {
        heading: $msg("obsidianLiveSyncSettingTab.titleExtraMenus"),
        items: [
            { key: "useAdvancedMode", control: { type: "toggle" } },
            { key: "usePowerUserMode", control: { type: "toggle" } },
            { key: "useEdgeCaseMode", control: { type: "toggle" } },
        ],
    };
}
