export type P2PSetupConnectionProbeResult = { ok: true } | { ok: false; reason: string };

export interface P2PSetupConnectionProbe {
    setOnSetup(): void | Promise<void>;
    allowReconnection(): void | Promise<void>;
    open(): Promise<void>;
}

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
