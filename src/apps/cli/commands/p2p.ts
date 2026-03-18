import type { LiveSyncBaseCore } from "../../../LiveSyncBaseCore";
import { P2P_DEFAULT_SETTINGS } from "@lib/common/types";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { LiveSyncTrysteroReplicator } from "@lib/replication/trystero/LiveSyncTrysteroReplicator";
import { addP2PEventHandlers } from "@lib/replication/trystero/addP2PEventHandlers";
type CLIP2PPeer = {
    peerId: string;
    name: string;
};

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseTimeoutSeconds(value: string, commandName: string): number {
    const timeoutSec = Number(value);
    if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
        throw new Error(`${commandName} requires a non-negative timeout in seconds`);
    }
    return timeoutSec;
}

function validateP2PSettings(core: LiveSyncBaseCore<ServiceContext, any>) {
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

function createReplicator(core: LiveSyncBaseCore<ServiceContext, any>): LiveSyncTrysteroReplicator {
    validateP2PSettings(core);
    const replicator = new LiveSyncTrysteroReplicator({ services: core.services });
    addP2PEventHandlers(replicator);
    return replicator;
}

function getSortedPeers(replicator: LiveSyncTrysteroReplicator): CLIP2PPeer[] {
    return [...replicator.knownAdvertisements]
        .map((peer) => ({ peerId: peer.peerId, name: peer.name }))
        .sort((a, b) => a.peerId.localeCompare(b.peerId));
}

export async function collectPeers(
    core: LiveSyncBaseCore<ServiceContext, any>,
    timeoutSec: number
): Promise<CLIP2PPeer[]> {
    const replicator = createReplicator(core);
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

export async function syncWithPeer(
    core: LiveSyncBaseCore<ServiceContext, any>,
    peerToken: string,
    timeoutSec: number
): Promise<CLIP2PPeer> {
    const replicator = createReplicator(core);
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
            throw pullResult.error;
        }
        const pushResult = (await replicator.requestSynchroniseToPeer(targetPeer.peerId)) as any;
        if (!pushResult || pushResult.ok !== true) {
            throw pushResult?.error ?? new Error("P2P sync failed while requesting remote sync");
        }

        return targetPeer;
    } finally {
        await replicator.close();
    }
}

export async function openP2PHost(core: LiveSyncBaseCore<ServiceContext, any>): Promise<LiveSyncTrysteroReplicator> {
    const replicator = createReplicator(core);
    await replicator.open();
    return replicator;
}
