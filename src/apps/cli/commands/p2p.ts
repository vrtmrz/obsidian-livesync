import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { P2P_DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { LiveSyncError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";
import type { P2PPeerConnectionMetrics, P2PServiceViews } from "@vrtmrz/livesync-commonlib/p2p";
import { fsPromises } from "@vrtmrz/livesync-commonlib/node";

type CLIP2PPeer = {
    peerId: string;
    name: string;
};

type CLIP2PService = Pick<P2PServiceViews, "transportLifecycle" | "peerDirectory" | "targetedTransfer" | "diagnostics">;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => compatGlobal.setTimeout(resolve, ms));
}

export function parseTimeoutSeconds(value: string, commandName: string): number {
    const timeoutSec = Number(value);
    if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
        throw new Error(`${commandName} requires a non-negative timeout in seconds`);
    }
    return timeoutSec;
}

function validateP2PSettings(core: LiveSyncBaseCore<ServiceContext, never>) {
    const settings = core.services.setting.currentSettings();
    if (!settings.P2P_Enabled) {
        throw new Error("P2P is disabled in settings (P2P_Enabled=false)");
    }
    if (!settings.P2P_AppID) {
        settings.P2P_AppID = P2P_DEFAULT_SETTINGS.P2P_AppID;
    }
    // CLI mode is non-interactive.
    settings.P2P_IsHeadless = true;
}

function requireP2PService(
    core: LiveSyncBaseCore<ServiceContext, never>,
    service: CLIP2PService | undefined
): CLIP2PService {
    validateP2PSettings(core);
    if (!service) {
        throw new Error("P2P service is not available. Ensure the P2P feature was composed for this CLI process.");
    }
    return service;
}

function getSortedPeers(service: Pick<P2PServiceViews, "peerDirectory">): CLIP2PPeer[] {
    return [...service.peerDirectory.getPeers()]
        .map((peer) => ({ peerId: peer.peerId, name: peer.name }))
        .sort((a, b) => a.peerId.localeCompare(b.peerId));
}

export async function collectPeers(
    core: LiveSyncBaseCore<ServiceContext, never>,
    p2pService: CLIP2PService | undefined,
    timeoutSec: number
): Promise<CLIP2PPeer[]> {
    const service = requireP2PService(core, p2pService);
    await service.transportLifecycle.connect();
    try {
        await delay(timeoutSec * 1000);
        return getSortedPeers(service);
    } finally {
        await service.transportLifecycle.disconnect();
    }
}

function resolvePeer(peers: CLIP2PPeer[], peerToken: string): CLIP2PPeer | undefined {
    const byId = peers.find((peer) => peer.peerId === peerToken);
    if (byId) {
        return byId;
    }
    const byName = peers.filter((peer) => peer.name === peerToken);
    if (byName.length > 1) {
        throw new Error(`Multiple peers matched by name '${peerToken}'. Use peer-id instead.`);
    }
    if (byName.length === 1) {
        return byName[0];
    }
    return undefined;
}

async function writePeerConnectionStatsIfRequested(
    service: Pick<P2PServiceViews, "diagnostics">,
    peer: CLIP2PPeer
): Promise<void> {
    const outputPath = process.env.LIVESYNC_P2P_STATS_JSONL?.trim();
    if (!outputPath) {
        return;
    }

    const stats = await service.diagnostics.getPeerConnectionMetrics(peer.peerId);
    const payload = createPeerConnectionStatsPayload(peer, stats, new Date().toISOString());
    await fsPromises.appendFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
}

/** Build the stable JSONL record consumed by the P2P benchmark harnesses. */
export function createPeerConnectionStatsPayload(
    peer: CLIP2PPeer,
    stats: P2PPeerConnectionMetrics | undefined,
    generatedAt: string
) {
    const localCandidate = stats?.localCandidate;
    const remoteCandidate = stats?.remoteCandidate;
    const selectedPath =
        localCandidate && remoteCandidate
            ? `${localCandidate.candidateType}<->${remoteCandidate.candidateType}`
            : "unknown";

    const payload = {
        generatedAt,
        command: "p2p-sync",
        peerId: peer.peerId,
        peerName: peer.name,
        candidatePathCollected: stats?.selectedPairPresent ?? false,
        selectedPath,
        selectedPair: stats
            ? {
                  id: stats.selectedPairId,
                  state: stats.state,
                  currentRoundTripTime: stats.currentRoundTripTime,
                  totalRoundTripTime: stats.totalRoundTripTime,
                  requestsSent: stats.requestsSent,
                  responsesReceived: stats.responsesReceived,
                  packetsDiscardedOnSend: stats.packetsDiscardedOnSend,
                  bytesSent: stats.bytesSent,
                  bytesReceived: stats.bytesReceived,
              }
            : undefined,
        localCandidate,
        remoteCandidate,
    };
    return payload;
}

export async function syncWithPeer(
    core: LiveSyncBaseCore<ServiceContext, never>,
    p2pService: CLIP2PService | undefined,
    peerToken: string,
    timeoutSec: number
): Promise<CLIP2PPeer> {
    const service = requireP2PService(core, p2pService);
    await service.transportLifecycle.connect();
    try {
        const timeoutMs = timeoutSec * 1000;
        const start = Date.now();
        let targetPeer: CLIP2PPeer | undefined;

        while (Date.now() - start <= timeoutMs) {
            const peers = getSortedPeers(service);
            targetPeer = resolvePeer(peers, peerToken);
            if (targetPeer) {
                break;
            }
            await delay(200);
        }

        if (!targetPeer) {
            throw new Error(`Peer '${peerToken}' was not found within ${timeoutSec} seconds`);
        }

        const pullResult = await service.targetedTransfer.pullFromPeer(targetPeer.peerId, { showNotice: false });
        if (pullResult && "error" in pullResult && pullResult.error) {
            throw pullResult.error instanceof Error ? pullResult.error : LiveSyncError.fromError(pullResult.error);
        }
        const pushResult = await service.targetedTransfer.requestPushToPeer(targetPeer.peerId);
        if (!pushResult || pushResult.ok !== true) {
            const err: unknown = pushResult && "error" in pushResult ? pushResult.error : undefined;
            throw err instanceof Error
                ? err
                : LiveSyncError.fromError(err ?? "P2P sync failed while requesting remote sync");
        }

        await writePeerConnectionStatsIfRequested(service, targetPeer);
        return targetPeer;
    } finally {
        await service.transportLifecycle.disconnect();
    }
}

export async function openP2PHost(
    core: LiveSyncBaseCore<ServiceContext, never>,
    p2pService: CLIP2PService | undefined
): Promise<CLIP2PService> {
    const service = requireP2PService(core, p2pService);
    await service.transportLifecycle.connect();
    return service;
}
