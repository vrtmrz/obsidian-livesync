import {
    ACTIVE_P2P_RELAY_BINDING_CONFLICT,
    type P2PConnectionProbeAdmission,
    type P2PConnectionProbeSettings,
} from "@vrtmrz/livesync-commonlib/p2p";
import { P2PConnectionPaths, type P2PSyncSetting } from "@vrtmrz/livesync-commonlib/compat/common/types";

export type P2PSetupConnectionProbeResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string }
    | {
          readonly ok: false;
          readonly kind: "blocked";
          readonly reason: typeof ACTIVE_P2P_RELAY_BINDING_CONFLICT;
      };

export interface P2PSetupConnectionProbe {
    setOnSetup(): void | Promise<void>;
    allowReconnection(): void | Promise<void>;
    open(): Promise<void>;
}

/** Interpret the stable P2P owner's admission without constructing transport eagerly. */
export async function coordinateP2PSetupConnectionProbe<T extends P2PConnectionProbeSettings>(
    admission: P2PConnectionProbeAdmission,
    trialSettings: T,
    runOwnedTrial: (settings: T) => Promise<P2PSetupConnectionProbeResult>
): Promise<P2PSetupConnectionProbeResult> {
    const settlement = await admission.run(trialSettings, () => {
        // This trial checks signalling only; TURN allocation belongs to an actual connection.
        const settings: T & Partial<P2PSyncSetting> = { ...trialSettings };
        delete settings.P2P_managedType;
        delete settings.P2P_managedId;
        delete settings.P2P_managedToken;
        delete settings.P2P_iceServers;
        delete settings.P2P_iceServersExpiresAt;
        settings.P2P_turnServers = "";
        settings.P2P_turnUsername = "";
        settings.P2P_turnCredential = "";
        settings.P2P_connectionPath = P2PConnectionPaths.Automatic;
        return runOwnedTrial(settings);
    });
    if (settlement.status === "observed-active") return { ok: true };
    if (settlement.status === "blocked") {
        return {
            ok: false,
            kind: "blocked",
            reason: settlement.reason,
        };
    }
    return settlement.result;
}

/** Open one separately owned signalling connection and report its outcome. */
export async function probeP2PSetupConnection(
    replicator: P2PSetupConnectionProbe
): Promise<P2PSetupConnectionProbeResult> {
    try {
        await replicator.setOnSetup();
        await replicator.allowReconnection();
        await replicator.open();
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
