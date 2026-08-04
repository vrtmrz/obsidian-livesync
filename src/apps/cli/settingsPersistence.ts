import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import { activateRemoteConfiguration } from "@vrtmrz/livesync-commonlib/remote-configurations";
import type { CLICommand } from "./commands/types";

const SETTINGS_WRITE_COMMANDS = new Set<CLICommand>([
    "setup",
    "remote-add",
    "remote-rm",
    "remote-set",
    "remote-activate",
]);

const REMOTE_SETTINGS_WRITE_COMMANDS = new Set<CLICommand>([
    "remote-add",
    "remote-rm",
    "remote-set",
    "remote-activate",
]);

export const CLI_RUNTIME_ONLY_SETTING_KEYS = new Set<keyof ObsidianLiveSyncSettings>([
    "disableCheckingConfigMismatch",
    "suspendFileWatching",
    "suspendParseReplicationResult",
]);

function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneSettings(settings: ObsidianLiveSyncSettings): ObsidianLiveSyncSettings {
    return cloneJsonValue(settings);
}

function settingValuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function settingsEqual(left: ObsidianLiveSyncSettings, right: ObsidianLiveSyncSettings): boolean {
    return settingValuesEqual(left, right);
}

function settingsKeys(...settings: ObsidianLiveSyncSettings[]): Set<keyof ObsidianLiveSyncSettings> {
    return new Set(settings.flatMap((value) => Object.keys(value) as Array<keyof ObsidianLiveSyncSettings>));
}

function copySetting(
    target: ObsidianLiveSyncSettings,
    source: ObsidianLiveSyncSettings,
    key: keyof ObsidianLiveSyncSettings
): void {
    const targetRecord = target as unknown as Record<string, unknown>;
    const sourceRecord = source as unknown as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(sourceRecord, key)) {
        targetRecord[key] = cloneJsonValue(sourceRecord[key]);
    } else {
        delete targetRecord[key];
    }
}

function remoteSettingKeys(...settings: ObsidianLiveSyncSettings[]): Set<keyof ObsidianLiveSyncSettings> {
    const keys = new Set<keyof ObsidianLiveSyncSettings>([
        "remoteConfigurations",
        "activeConfigurationId",
        "P2P_ActiveRemoteConfigurationId",
        "remoteType",
    ]);
    for (const current of settings) {
        for (const configuration of Object.values(current.remoteConfigurations ?? {})) {
            try {
                const parsed = ConnectionStringParser.parse(configuration.uri);
                for (const key of Object.keys(parsed.settings) as Array<keyof ObsidianLiveSyncSettings>) {
                    keys.add(key);
                }
            } catch {
                // The setting service reports invalid remote configurations when loading them.
            }
        }
    }
    return keys;
}

export function changedSettingKeys(
    before: ObsidianLiveSyncSettings,
    after: ObsidianLiveSyncSettings
): Set<keyof ObsidianLiveSyncSettings> {
    const changed = new Set<keyof ObsidianLiveSyncSettings>();
    for (const key of settingsKeys(before, after)) {
        if (!settingValuesEqual(before[key], after[key])) {
            changed.add(key);
        }
    }
    return changed;
}

export function isSettingsWriteCommand(command: CLICommand): boolean {
    return SETTINGS_WRITE_COMMANDS.has(command);
}

export function reconcileDurableSettings(options: {
    durableBase: ObsidianLiveSyncSettings;
    runtimeBaseline: ObsidianLiveSyncSettings;
    runtimeCurrent: ObsidianLiveSyncSettings;
    preserveKeys: ReadonlySet<keyof ObsidianLiveSyncSettings>;
    command?: CLICommand;
}): ObsidianLiveSyncSettings {
    const durable = cloneSettings(options.durableBase);
    for (const key of settingsKeys(options.runtimeBaseline, options.runtimeCurrent)) {
        if (options.preserveKeys.has(key)) continue;
        if (!settingValuesEqual(options.runtimeBaseline[key], options.runtimeCurrent[key])) {
            copySetting(durable, options.runtimeCurrent, key);
        }
    }

    if (options.command) {
        if (REMOTE_SETTINGS_WRITE_COMMANDS.has(options.command)) {
            copySetting(durable, options.runtimeCurrent, "remoteConfigurations");
            copySetting(durable, options.runtimeCurrent, "activeConfigurationId");
            copySetting(durable, options.runtimeCurrent, "P2P_ActiveRemoteConfigurationId");

            if (durable.activeConfigurationId) {
                activateRemoteConfiguration(durable, durable.activeConfigurationId);
            }
        } else {
            // Commands such as remote-status may activate a profile temporarily. Only
            // the dedicated remote settings commands are allowed to retain that switch.
            for (const key of remoteSettingKeys(options.durableBase, options.runtimeBaseline, options.runtimeCurrent)) {
                copySetting(durable, options.durableBase, key);
            }
        }
    }

    return durable;
}

export function preserveStoredSetting(
    candidateText: string,
    originalText: string | undefined,
    key: keyof ObsidianLiveSyncSettings
): string {
    if (originalText === undefined) return candidateText;
    try {
        const candidate = JSON.parse(candidateText) as ObsidianLiveSyncSettings;
        const original = JSON.parse(originalText) as ObsidianLiveSyncSettings;
        if (Object.prototype.hasOwnProperty.call(original, key)) {
            copySetting(candidate, original, key);
        } else {
            delete (candidate as unknown as Record<string, unknown>)[key];
        }
        return JSON.stringify(candidate, null, 2);
    } catch {
        return candidateText;
    }
}

export function applyStoredSetting(
    target: ObsidianLiveSyncSettings,
    storedText: string | undefined,
    key: keyof ObsidianLiveSyncSettings
): void {
    if (storedText === undefined) return;
    try {
        const stored = JSON.parse(storedText) as ObsidianLiveSyncSettings;
        if (Object.prototype.hasOwnProperty.call(stored, key)) {
            copySetting(target, stored, key);
        } else {
            delete (target as unknown as Record<string, unknown>)[key];
        }
    } catch {
        // The setting service owns validation and recovery of malformed files.
    }
}
