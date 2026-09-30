import type { P2PSyncSetting } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { acquireCloudflareTurnCredentials, type CloudflareTurnFetch } from "@/integrations/cloudflare/turnCredentials";
import { validateManagedTurnSettings } from "@/integrations/turnSettings";

/** Prepare a connection copy using the host's HTTP adapter. */
export function useP2PSettingsPreparation(fetch: CloudflareTurnFetch) {
    return async (settings: Readonly<P2PSyncSetting>, signal: AbortSignal): Promise<P2PSyncSetting> => {
        const error = validateManagedTurnSettings(settings);
        if (error) throw new Error(error);
        if (!settings.P2P_managedType) return { ...settings };
        const { iceServers, expiresAt } = await acquireCloudflareTurnCredentials(
            { turnKeyId: settings.P2P_managedId ?? "", apiToken: settings.P2P_managedToken ?? "" },
            { fetch },
            signal
        );
        return { ...settings, P2P_iceServers: iceServers, P2P_iceServersExpiresAt: expiresAt };
    };
}
