import {
    ACTIVE_P2P_RELAY_BINDING_CONFLICT,
    type P2PConnectionProbeAdmission,
    type P2PConnectionProbeSettings,
} from "@vrtmrz/livesync-commonlib/p2p";

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
export async function coordinateP2PSetupConnectionProbe(
    admission: P2PConnectionProbeAdmission,
    trialSettings: P2PConnectionProbeSettings,
    runOwnedTrial: () => Promise<P2PSetupConnectionProbeResult>
): Promise<P2PSetupConnectionProbeResult> {
    const settlement = await admission.run(trialSettings, runOwnedTrial);
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
