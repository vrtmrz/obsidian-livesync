import type { P2PConnectionInfo } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { CLOUDFLARE_TURN_TYPE, validateCloudflareTurnConfiguration } from "./cloudflare/settings";

/** Validate provider inputs without requesting credentials. */
export function validateManagedTurnSettings(settings: Partial<P2PConnectionInfo>): string | undefined {
    if (settings.P2P_managedType === undefined || settings.P2P_managedType === "") return undefined;
    if (settings.P2P_managedType !== CLOUDFLARE_TURN_TYPE) {
        return "The selected TURN configuration is not supported.";
    }
    return validateCloudflareTurnConfiguration({
        turnKeyId: settings.P2P_managedId ?? "",
        apiToken: settings.P2P_managedToken ?? "",
    });
}
