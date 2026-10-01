import { LOG_LEVEL_NOTICE, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    encodeTimeBoundSetupURI,
    getTimeBoundSetupURIUsableUntil,
    isTimeBoundSetupURIUsableNow,
    type TimeBoundSetupURIMode,
} from "@vrtmrz/livesync-commonlib/setup-uri";
import { EVENT_REQUEST_COPY_SETUP_URI } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { SetupFeatureHost } from "./types";

export async function askEncryptingPassphrase(host: SetupFeatureHost): Promise<string | false> {
    return await host.services.UI.confirm.askString(
        "Encrypt your settings",
        "The passphrase to encrypt the setup URI",
        "",
        true
    );
}

function formatWindowEnd(usableUntil: number): string {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
    }).format(new Date(usableUntil));
}

async function askSetupURIMode(
    host: SetupFeatureHost
): Promise<{ mode: TimeBoundSetupURIMode; usableUntil: number | null } | false> {
    let usableUntil: number | null = null;
    try {
        usableUntil = getTimeBoundSetupURIUsableUntil();
    } catch {
        // Compatible generation remains available when the device clock is invalid.
    }
    const timeBound = "Time-bound";
    const compatible = "Compatible (no time limit)";
    const cancel = "Cancel";
    const buttons = usableUntil === null ? [compatible, cancel] : [timeBound, compatible, cancel];
    const message =
        usableUntil === null
            ? "Time-bound Setup URIs require a valid device clock. Compatible URIs have no time limit and work with older clients."
            : `Time-bound Setup URIs can be opened until ${formatWindowEnd(usableUntil)}. This is the end of the current fixed seven-day UTC window, not seven days from now. Compatible URIs have no time limit and work with older clients.`;
    const selected = await host.services.UI.confirm.askSelectStringDialogue(message, buttons, {
        title: "Setup URI availability",
        defaultAction: usableUntil === null ? compatible : timeBound,
    });
    if (selected === timeBound && usableUntil !== null) return { mode: "ephemeral", usableUntil };
    if (selected === compatible) return { mode: "persistent", usableUntil: null };
    return false;
}

async function generateAndCopySetupURI(
    host: SetupFeatureHost,
    log: LogFunction,
    removeProperties: (keyof ObsidianLiveSyncSettings)[],
    skipDefaultValue: boolean
) {
    const passphrase = await askEncryptingPassphrase(host);
    if (passphrase === false) return;
    while (true) {
        const choice = await askSetupURIMode(host);
        if (choice === false) return;
        let result;
        try {
            result = await encodeTimeBoundSetupURI(host.services.setting.currentSettings(), passphrase, {
                mode: choice.mode,
                removeProperties,
                skipDefaultValue,
            });
        } catch (error) {
            if (
                choice.mode === "ephemeral" &&
                error instanceof Error &&
                error.message === "Setup URI window changed during generation"
            ) {
                continue;
            }
            throw error;
        }
        if (result.usableUntil !== choice.usableUntil || !isTimeBoundSetupURIUsableNow(result.usableUntil)) {
            continue;
        }
        if (await host.services.UI.promptCopyToClipboard("Setup URI", result.uri)) {
            log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
        }
        return;
    }
}

export async function copySetupURI(host: SetupFeatureHost, log: LogFunction, stripExtra = true) {
    await generateAndCopySetupURI(host, log, stripExtra ? ["pluginSyncExtendedSetting"] : [], true);
}

export async function copySetupURIFull(host: SetupFeatureHost, log: LogFunction) {
    await generateAndCopySetupURI(host, log, [], false);
}

export function useSetupURIFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>) {
    const log = createInstanceLogFunction("SF:SetupURI", host.services.API);
    host.services.appLifecycle.onLoaded.addHandler(() => {
        host.services.API.addCommand({
            id: "livesync-copysetupuri",
            name: "Copy settings as a new setup URI",
            checkCallback: (checking) => {
                if (!host.services.setting.currentSettings().isConfigured) return false;
                if (!checking) fireAndForget(copySetupURI(host, log));
                return true;
            },
        });

        host.services.API.addCommand({
            id: "livesync-copysetupuri-short",
            name: "Copy settings as a new setup URI (With customization sync)",
            checkCallback: (checking) => {
                const settings = host.services.setting.currentSettings();
                if (!settings.isConfigured || !settings.usePluginSync) return false;
                if (!checking) fireAndForget(copySetupURI(host, log, false));
                return true;
            },
        });

        host.services.API.addCommand({
            id: "livesync-copysetupurifull",
            name: "Copy settings as a new setup URI (Full)",
            checkCallback: (checking) => {
                const settings = host.services.setting.currentSettings();
                if (!settings.isConfigured || !settings.useAdvancedMode) return false;
                if (!checking) fireAndForget(copySetupURIFull(host, log));
                return true;
            },
        });

        host.services.context.events.onEvent(EVENT_REQUEST_COPY_SETUP_URI, () =>
            fireAndForget(() => copySetupURI(host, log))
        );
        return Promise.resolve(true);
    });
}
