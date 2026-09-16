import {
    hasManagedP2PTurnConfiguration,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { pickP2PSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { CLOUDFLARE_TURN_TYPE } from "@/integrations/cloudflare/settings";

/** Include inactive profiles when deciding whether Markdown would disclose provider settings. */
export function hasManagedTurnSettings(settings: Partial<ObsidianLiveSyncSettings>): boolean {
    return (
        hasManagedP2PTurnConfiguration(settings) ||
        Object.values(settings.remoteConfigurations ?? {}).some(({ uri }) => {
            if (!uri.startsWith("sls+p2p://")) return false;
            const queryStart = uri.indexOf("?");
            return (
                queryStart >= 0 && new URLSearchParams(uri.slice(queryStart + 1).split("#", 1)[0]).has("managedType")
            );
        })
    );
}

/** Reports retain a recognised provider label and omit issued credentials. */
export function redactTurnSettingsForReport(settings: Partial<ObsidianLiveSyncSettings>): void {
    if (settings.P2P_managedType) {
        settings.P2P_managedType =
            settings.P2P_managedType === CLOUDFLARE_TURN_TYPE ? CLOUDFLARE_TURN_TYPE : "redacted";
    }
    if (settings.P2P_managedId !== undefined) settings.P2P_managedId = "redacted";
    if (settings.P2P_managedToken !== undefined) settings.P2P_managedToken = "redacted";
    delete settings.P2P_iceServers;
    delete settings.P2P_iceServersExpiresAt;
}

/** Managed connection profiles are shared through Setup URIs and QR codes. */
export function omitManagedTurnProfilesFromMarkdown(settings: Partial<ObsidianLiveSyncSettings>): void {
    delete settings.P2P_iceServers;
    delete settings.P2P_iceServersExpiresAt;
    if (!hasManagedTurnSettings(settings)) return;
    delete settings.P2P_managedType;
    delete settings.P2P_managedId;
    delete settings.P2P_managedToken;
    delete settings.remoteConfigurations;
    delete settings.activeConfigurationId;
    delete settings.P2P_ActiveRemoteConfigurationId;
}

/** Preserve the complete connection when Markdown omits its profile group. */
export function preserveManagedTurnProfilesOnMarkdownImport(
    incoming: Partial<ObsidianLiveSyncSettings>,
    current: ObsidianLiveSyncSettings,
    merged: ObsidianLiveSyncSettings
): void {
    if (
        !hasManagedTurnSettings(current) ||
        incoming.remoteConfigurations !== undefined ||
        incoming.P2P_managedType !== undefined
    )
        return;
    merged.remoteConfigurations = structuredClone(current.remoteConfigurations);
    merged.activeConfigurationId = current.activeConfigurationId;
    merged.P2P_ActiveRemoteConfigurationId = current.P2P_ActiveRemoteConfigurationId;
    Object.assign(merged, pickP2PSyncSettings(current));
}
