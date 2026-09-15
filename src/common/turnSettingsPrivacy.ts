import {
    hasManagedP2PIceServerSource,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import { iceServerSourceDefinitions } from "@/integrations/iceServerSources";

/** Include inactive profiles when deciding whether Markdown would disclose source settings. */
export function hasManagedTurnSettings(settings: Partial<ObsidianLiveSyncSettings>): boolean {
    return (
        hasManagedP2PIceServerSource(settings) ||
        Object.values(settings.remoteConfigurations ?? {}).some(({ uri }) => {
            if (!uri.startsWith("sls+p2p://")) return false;
            const queryStart = uri.indexOf("?");
            return queryStart >= 0 && new URLSearchParams(uri.slice(queryStart + 1).split("#", 1)[0]).has("source");
        })
    );
}

/** Reports retain the selected source label, but no opaque source configuration. */
export function redactTurnSourceForReport(settings: Partial<ObsidianLiveSyncSettings>): void {
    if (settings.P2P_iceServerSource !== undefined) {
        settings.P2P_iceServerSource = {
            version: 1,
            id:
                iceServerSourceDefinitions.find((source) => source.id === settings.P2P_iceServerSource?.id)?.id ??
                "redacted",
            configuration: { redacted: true },
        };
    }
}

/** Managed connection profiles are shared through Setup URIs and QR codes. */
export function omitManagedTurnProfilesFromMarkdown(settings: Partial<ObsidianLiveSyncSettings>): void {
    if (!hasManagedTurnSettings(settings)) return;
    delete settings.P2P_iceServerSource;
    delete settings.remoteConfigurations;
    delete settings.activeConfigurationId;
    delete settings.P2P_ActiveRemoteConfigurationId;
}

/** An omitted profile group leaves this device's existing connection selection intact. */
export function preserveManagedTurnProfilesOnMarkdownImport(
    incoming: Partial<ObsidianLiveSyncSettings>,
    current: ObsidianLiveSyncSettings,
    merged: ObsidianLiveSyncSettings
): void {
    if (
        !hasManagedTurnSettings(current) ||
        incoming.remoteConfigurations !== undefined ||
        incoming.P2P_iceServerSource !== undefined
    ) {
        return;
    }
    merged.remoteConfigurations = structuredClone(current.remoteConfigurations);
    merged.activeConfigurationId = current.activeConfigurationId;
    merged.P2P_ActiveRemoteConfigurationId = current.P2P_ActiveRemoteConfigurationId;
    merged.P2P_iceServerSource = structuredClone(current.P2P_iceServerSource);
}
