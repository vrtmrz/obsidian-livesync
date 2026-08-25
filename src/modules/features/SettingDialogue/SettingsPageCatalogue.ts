import { $msg } from "@/common/translation";
import {
    LEVEL_ADVANCED,
    LEVEL_EDGE_CASE,
    LEVEL_POWER_USER,
    type ConfigLevel,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SettingDefinitionGroup } from "obsidian";
import { createAdvancedSettingSpecGroups, type AdvancedSettingSpecContext } from "./AdvancedSettingSpecs.ts";
import { toObsidianSettingDefinition, type PersistedSettingKey, type SettingSpec } from "./SettingSpec.ts";
import { getConfig } from "./settingConstants.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import {
    createExtraMenuSettingSpecGroup,
    createGeneralSettingSpecGroups,
    type GeneralSettingSpecContext,
} from "./GeneralSettingSpecs.ts";
import { paneAdvanced } from "./PaneAdvanced.ts";
import { paneChangeLog } from "./PaneChangeLog.ts";
import { paneCustomisationSync } from "./PaneCustomisationSync.ts";
import { paneGeneral } from "./PaneGeneral.ts";
import { paneHatch } from "./PaneHatch.ts";
import { paneMaintenance } from "./PaneMaintenance.ts";
import { paneHelp } from "./PaneHelp.ts";
import { panePatches } from "./PanePatches.ts";
import { panePowerUsers } from "./PanePowerUsers.ts";
import { paneRemoteConfig } from "./PaneRemoteConfig.ts";
import { paneSelector } from "./PaneSelector.ts";
import { paneQuickSetup } from "./PaneQuickSetup.ts";
import { paneSyncSettings } from "./PaneSyncSettings.ts";

/** The existing pane renderer used by the imperative settings tab and custom pages. */
export type SettingsPaneRenderer = (
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    functions: PageFunctions
) => void;

export type SettingsPageContent = "native" | "custom";

/** One established settings page, shared by the imperative and declarative renderers. */
export type SettingsPageEntry = {
    id: string;
    name: () => string;
    icon: string;
    order: number;
    level?: ConfigLevel;
    content: SettingsPageContent;
    legacy: SettingsPaneRenderer;
};

export type SettingsRootGroupEntry = {
    icon: string;
    name: () => string;
};

/** Root groups used only by Obsidian's declarative settings landing page. */
const SETTINGS_ROOT_GROUP_CATALOGUE = {
    "quick-setup": {
        icon: "🧙‍♂️",
        name: () => $msg("obsidianLiveSyncSettingTab.titleQuickSetup"),
    },
    synchronisation: {
        icon: "🔄",
        name: () => $msg("obsidianLiveSyncSettingTab.titleSynchronisation"),
    },
    "general-settings": {
        icon: "⚙️",
        name: () => $msg("obsidianLiveSyncSettingTab.panelGeneralSettings"),
    },
    "setup-other-devices": {
        icon: "📲",
        name: () => $msg("obsidianLiveSyncSettingTab.titleSetupOtherDevices"),
    },
    "maintenance-and-recovery": {
        icon: "🛠️",
        name: () => $msg("obsidianLiveSyncSettingTab.titleMaintenanceAndRecovery"),
    },
    "extra-features": {
        icon: "🧩",
        name: () => $msg("obsidianLiveSyncSettingTab.titleExtraFeaturesGroup"),
    },
    "advanced-settings": {
        icon: "🔧",
        name: () => $msg("obsidianLiveSyncSettingTab.titleAdvancedSettings"),
    },
    "help-and-information": {
        icon: "ℹ️",
        name: () => $msg("obsidianLiveSyncSettingTab.titleHelpAndInformation"),
    },
} as const satisfies Record<string, SettingsRootGroupEntry>;

export type SettingsRootGroupId = keyof typeof SETTINGS_ROOT_GROUP_CATALOGUE;

/** Resolve a late-translated root-group label while keeping its icon separate until the Obsidian API boundary. */
export function getSettingsRootGroupEntry(id: SettingsRootGroupId): SettingsRootGroupEntry {
    return SETTINGS_ROOT_GROUP_CATALOGUE[id];
}

/**
 * Build the explicit page list in the same order as the existing settings tab.
 *
 * Names remain functions so a catalogue refresh observes the current language,
 * while constructing the catalogue itself performs no rendering or persistence.
 */
export function createSettingsPageCatalogue(): SettingsPageEntry[] {
    return [
        {
            id: "change-log",
            name: () => $msg("obsidianLiveSyncSettingTab.panelChangeLog"),
            icon: "💬",
            order: 100,
            level: undefined,
            content: "custom",
            legacy: paneChangeLog,
        },
        {
            id: "quick-setup",
            name: () => $msg("obsidianLiveSyncSettingTab.titleQuickSetup"),
            icon: "🧙‍♂️",
            order: 110,
            level: undefined,
            content: "custom",
            legacy: paneQuickSetup,
        },
        {
            id: "general",
            name: () => $msg("obsidianLiveSyncSettingTab.panelGeneralSettings"),
            icon: "⚙️",
            order: 20,
            level: undefined,
            content: "custom",
            legacy: paneGeneral,
        },
        {
            id: "remote-configuration",
            name: () => $msg("obsidianLiveSyncSettingTab.panelRemoteConfiguration"),
            icon: "🛰️",
            order: 0,
            level: undefined,
            content: "custom",
            legacy: paneRemoteConfig,
        },
        {
            id: "synchronisation",
            name: () => $msg("obsidianLiveSyncSettingTab.titleSyncSettings"),
            icon: "🔄",
            order: 30,
            level: undefined,
            content: "custom",
            legacy: paneSyncSettings,
        },
        {
            id: "selector",
            name: () => "Selector",
            icon: "🚦",
            order: 33,
            level: LEVEL_ADVANCED,
            content: "custom",
            legacy: paneSelector,
        },
        {
            id: "customisation-sync",
            name: () => "Customisation sync",
            icon: "🔌",
            order: 60,
            level: LEVEL_ADVANCED,
            content: "custom",
            legacy: paneCustomisationSync,
        },
        {
            id: "hatch",
            name: () => "Hatch",
            icon: "🧰",
            order: 50,
            level: undefined,
            content: "custom",
            legacy: paneHatch,
        },
        {
            id: "advanced",
            name: () => "Advanced",
            icon: "🔧",
            order: 46,
            level: LEVEL_ADVANCED,
            content: "native",
            legacy: paneAdvanced,
        },
        {
            id: "power-users",
            name: () => "Power users",
            icon: "💪",
            order: 47,
            level: LEVEL_POWER_USER,
            content: "custom",
            legacy: panePowerUsers,
        },
        {
            id: "patches",
            name: () => "Patches",
            icon: "🩹",
            order: 51,
            level: LEVEL_EDGE_CASE,
            content: "custom",
            legacy: panePatches,
        },
        {
            id: "maintenance",
            name: () => "Maintenance",
            icon: "🎛️",
            order: 70,
            level: undefined,
            content: "custom",
            legacy: paneMaintenance,
        },
        {
            id: "help",
            name: () => $msg("obsidianLiveSyncSettingTab.titleHelpAndTroubleshooting"),
            icon: "❓",
            order: 90,
            level: undefined,
            content: "custom",
            legacy: paneHelp,
        },
    ];
}

const numberRangeMessage = ({ min, max }: { min?: number; max?: number }): string =>
    $msg("liveSyncSetting.valueShouldBeInRange", {
        min: min === undefined ? "~" : `${min}`,
        max: max === undefined ? "~" : `${max}`,
    });

function toSettingDefinition(spec: SettingSpec): ReturnType<typeof toObsidianSettingDefinition> {
    const metadata = getConfig(spec.key);
    if (!metadata) {
        throw new Error(`Missing translated setting metadata for ${spec.key}`);
    }
    return toObsidianSettingDefinition(spec, metadata, {
        valueShouldBeInRange: numberRangeMessage,
    });
}

/** Convert the existing Advanced specifications to native Obsidian groups. */
export function createAdvancedSettingDefinitionGroups(
    context: AdvancedSettingSpecContext
): SettingDefinitionGroup<PersistedSettingKey>[] {
    return createAdvancedSettingSpecGroups(context).map((group) => ({
        type: "group",
        heading: group.heading,
        items: group.items.map(toSettingDefinition),
    }));
}

/** Convert the shared General specifications to native Obsidian groups. */
export function createGeneralSettingDefinitionGroups(
    context: GeneralSettingSpecContext
): SettingDefinitionGroup<PersistedSettingKey>[] {
    return createGeneralSettingSpecGroups(context).map((group) => ({
        type: "group",
        heading: group.heading,
        items: group.items.map(toSettingDefinition),
    }));
}

/** Convert the Extra menus feature-level controls to native Obsidian settings. */
export function createExtraMenuSettingDefinitions(): ReturnType<typeof toObsidianSettingDefinition>[] {
    return createExtraMenuSettingSpecGroup().items.map(toSettingDefinition);
}
