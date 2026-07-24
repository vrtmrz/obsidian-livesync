import { LOG_LEVEL_NOTICE, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { encodeSettingsToSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
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

export async function copySetupURI(host: SetupFeatureHost, log: LogFunction, stripExtra = true) {
    const encryptingPassphrase = await askEncryptingPassphrase(host);
    if (encryptingPassphrase === false) return;
    const encryptedURI = await encodeSettingsToSetupURI(
        host.services.setting.currentSettings(),
        encryptingPassphrase,
        [...((stripExtra ? ["pluginSyncExtendedSetting"] : []) as (keyof ObsidianLiveSyncSettings)[])],
        true
    );
    if (await host.services.UI.promptCopyToClipboard("Setup URI", encryptedURI)) {
        log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
}

export async function copySetupURIFull(host: SetupFeatureHost, log: LogFunction) {
    const encryptingPassphrase = await askEncryptingPassphrase(host);
    if (encryptingPassphrase === false) return;
    const encryptedURI = await encodeSettingsToSetupURI(
        host.services.setting.currentSettings(),
        encryptingPassphrase,
        [],
        false
    );
    if (await host.services.UI.promptCopyToClipboard("Setup URI", encryptedURI)) {
        log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
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
