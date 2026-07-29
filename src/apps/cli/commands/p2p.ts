import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { P2P_DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { LiveSyncTrysteroReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/LiveSyncTrysteroReplicator";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { LiveSyncError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";
import { getPeerConnectionStats } from "@vrtmrz/livesync-commonlib/compat/rpc/transports/DiagRTCPeerConnections.utils";
import { fsPromises } from "@vrtmrz/livesync-commonlib/node";

type CLIP2PPeer = {
    peerId: string;
    name: string;
};

type CandidateSummary = {
    id: string;
    candidateType: string;
    protocol: string;
    relayProtocol: string;
};

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

async function createReplicator(core: LiveSyncBaseCore<ServiceContext, never>): Promise<LiveSyncTrysteroReplicator> {
    validateP2PSettings(core);
    const replicator = await core.services.replicator.getNewReplicator();
    if (!replicator) {
        throw new Error("Failed to create replicator instance. Ensure P2P is enabled in settings.");
    }
    if (!(replicator instanceof LiveSyncTrysteroReplicator)) {
        throw new Error("Unexpected replicator type. Expected LiveSyncTrysteroReplicator.");
    }
    return replicator;
}

function getSortedPeers(replicator: LiveSyncTrysteroReplicator): CLIP2PPeer[] {
    return [...replicator.knownAdvertisements]
        .map((peer) => ({ peerId: peer.peerId, name: peer.name }))
        .sort((a, b) => a.peerId.localeCompare(b.peerId));
}

export async function collectPeers(
    core: LiveSyncBaseCore<ServiceContext, never>,
    timeoutSec: number
): Promise<CLIP2PPeer[]> {
    const replicator = await createReplicator(core);
    await replicator.open();
    try {
        await delay(timeoutSec * 1000);
        return getSortedPeers(replicator);
    } finally {
        await replicator.close();
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

function getReportValue<T extends string | number>(
    report: Record<string, unknown> | undefined,
    key: string
): T | "unknown" {
    const value = report?.[key];
    return typeof value === "string" || typeof value === "number" ? (value as T) : "unknown";
}

function summariseCandidate(reports: unknown[], candidateId: string): CandidateSummary | undefined {
    if (candidateId === "unknown") {
        return undefined;
    }
    const report = reports.map((r) => r as Record<string, unknown>).find((r) => r.id === candidateId);
    if (!report) {
        return undefined;
    }
    return {
        id: candidateId,
        candidateType: getReportValue<string>(report, "candidateType"),
        protocol: getReportValue<string>(report, "protocol"),
        relayProtocol: getReportValue<string>(report, "relayProtocol"),
    };
}

async function writePeerConnectionStatsIfRequested(
    replicator: LiveSyncTrysteroReplicator,
    peer: CLIP2PPeer
): Promise<void> {
    const outputPath = process.env.LIVESYNC_P2P_STATS_JSONL?.trim();
    if (!outputPath) {
        return;
    }

    const peerConnection = replicator.rawHost?.room?.getPeers()[peer.peerId];
    const stats = peerConnection ? await getPeerConnectionStats(`cli-p2p-${peer.peerId}`, peerConnection) : undefined;
    const localCandidate = summariseCandidate(stats?.reports ?? [], stats?.localCandidateId ?? "unknown");
    const remoteCandidate = summariseCandidate(stats?.reports ?? [], stats?.remoteCandidateId ?? "unknown");
    const selectedPath =
        localCandidate && remoteCandidate
            ? `${localCandidate.candidateType}<->${remoteCandidate.candidateType}`
            : "unknown";

    const payload = {
        generatedAt: new Date().toISOString(),
        command: "p2p-sync",
        peerId: peer.peerId,
        peerName: peer.name,
        candidatePathCollected: !!stats?.selectedPair,
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
    await fsPromises.appendFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function syncWithPeer(
    core: LiveSyncBaseCore<ServiceContext, never>,
    peerToken: string,
    timeoutSec: number
): Promise<CLIP2PPeer> {
    const replicator = await createReplicator(core);
    await replicator.open();
    try {
        const timeoutMs = timeoutSec * 1000;
        const start = Date.now();
        let targetPeer: CLIP2PPeer | undefined;

        while (Date.now() - start <= timeoutMs) {
            const peers = getSortedPeers(replicator);
            targetPeer = resolvePeer(peers, peerToken);
            if (targetPeer) {
                break;
            }
            await delay(200);
        }

        if (!targetPeer) {
            throw new Error(`Peer '${peerToken}' was not found within ${timeoutSec} seconds`);
        }

        const pullResult = await replicator.replicateFrom(targetPeer.peerId, false);
        if (pullResult && "error" in pullResult && pullResult.error) {
            throw pullResult.error instanceof Error ? pullResult.error : LiveSyncError.fromError(pullResult.error);
        }
        const pushResult = await replicator.requestSynchroniseToPeer(targetPeer.peerId);
        if (!pushResult || pushResult.ok !== true) {
            const err: unknown = pushResult && "error" in pushResult ? pushResult.error : undefined;
            throw err instanceof Error
                ? err
                : LiveSyncError.fromError(err ?? "P2P sync failed while requesting remote sync");
        }

        await writePeerConnectionStatsIfRequested(replicator, targetPeer);
        return targetPeer;
    } finally {
        await replicator.close();
    }
}

export async function openP2PHost(core: LiveSyncBaseCore<ServiceContext, never>): Promise<LiveSyncTrysteroReplicator> {
    const replicator = await createReplicator(core);
    await replicator.open();
    return replicator;
}
