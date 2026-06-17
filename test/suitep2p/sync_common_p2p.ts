/**
 * P2P-specific sync helpers.
 *
 * Derived from test/suite/sync_common.ts but with all acceptWebPeer() calls
 * removed. When using a CLI p2p-host with P2P_AutoAcceptingPeers="~.*", peer
 * acceptance is automatic and no Playwright dialog interaction is needed.
 */
import { expect } from "vitest";
import { waitForIdle, type LiveSyncHarness } from "../harness/harness";
import { RemoteTypes, type ObsidianLiveSyncSettings } from "@/lib/src/common/types";
import { delay } from "@/lib/src/common/utils";
import { LiveSyncTrysteroReplicator } from "@/lib/src/replication/trystero/LiveSyncTrysteroReplicator";
import { waitTaskWithFollowups } from "../lib/util";

const P2P_REPLICATION_TIMEOUT_MS = 180000;

async function testWebSocketConnection(relayUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`[P2P Debug] Testing WebSocket connection to ${relayUrl}`);
        try {
            const ws = new WebSocket(relayUrl);
            const timer = setTimeout(() => {
                ws.close();
                reject(new Error(`WebSocket connection to ${relayUrl} timed out`));
            }, 5000);
            ws.onopen = () => {
                clearTimeout(timer);
                console.log(`[P2P Debug] WebSocket connected to ${relayUrl} successfully`);
                ws.close();
                resolve();
            };
            ws.onerror = (e) => {
                clearTimeout(timer);
                console.error(`[P2P Debug] WebSocket error connecting to ${relayUrl}:`, e);
                reject(new Error(`WebSocket connection to ${relayUrl} failed`));
            };
        } catch (e) {
            console.error(`[P2P Debug] WebSocket constructor threw:`, e);
            reject(e);
        }
    });
}

async function waitForP2PPeers(harness: LiveSyncHarness) {
    if (harness.plugin.core.settings.remoteType === RemoteTypes.REMOTE_P2P) {
        const maxRetries = 20;
        let retries = maxRetries;
        const replicator = await harness.plugin.core.services.replicator.getActiveReplicator();
        console.log("[P2P Debug] replicator type:", replicator?.constructor?.name);
        if (!(replicator instanceof LiveSyncTrysteroReplicator)) {
            throw new Error("Replicator is not an instance of LiveSyncTrysteroReplicator");
        }

        // Ensure P2P is open (getActiveReplicator returns a fresh instance that may not be open yet)
        if (!replicator.server?.isServing) {
            console.log("[P2P Debug] P2P not yet serving, calling open()");
            // Test WebSocket connectivity first
            const relay = harness.plugin.core.settings.P2P_relays?.split(",")[0]?.trim();
            if (relay) {
                try {
                    await testWebSocketConnection(relay);
                } catch (e) {
                    console.error("[P2P Debug] WebSocket connectivity test failed:", e);
                }
            }
            try {
                await replicator.open();
                console.log("[P2P Debug] open() completed, isServing:", replicator.server?.isServing);
            } catch (e) {
                console.error("[P2P Debug] open() threw:", e);
            }
        }

        // Wait for P2P server to actually start (room joined)
        for (let i = 0; i < 30; i++) {
            const serving = replicator.server?.isServing;
            console.log(`[P2P Debug] isServing: ${serving} (${i}/30)`);
            if (serving) break;
            await delay(500);
            if (i === 29) throw new Error("P2P server did not start in time.");
        }

        while (retries-- > 0) {
            await delay(1000);
            const peers = replicator.knownAdvertisements;
            if (peers && peers.length > 0) {
                console.log("P2P peers connected:", peers);
                return;
            }
            console.log(`Waiting for any P2P peers to be connected... ${maxRetries - retries}/${maxRetries}`);
            console.dir(peers);
            await delay(1000);
        }
        console.log("Failed to connect P2P peers after retries");
        throw new Error("P2P peers did not connect in time.");
    }
}

export async function closeP2PReplicatorConnections(harness: LiveSyncHarness) {
    if (harness.plugin.core.settings.remoteType === RemoteTypes.REMOTE_P2P) {
        const replicator = await harness.plugin.core.services.replicator.getActiveReplicator();
        if (!(replicator instanceof LiveSyncTrysteroReplicator)) {
            throw new Error("Replicator is not an instance of LiveSyncTrysteroReplicator");
        }
        replicator.closeReplication();
        await delay(30);
        replicator.closeReplication();
        await delay(1000);
        console.log("P2P replicator connections closed");
    }
}

export async function performReplication(harness: LiveSyncHarness) {
    await waitForP2PPeers(harness);
    await delay(500);
    if (harness.plugin.core.settings.remoteType === RemoteTypes.REMOTE_P2P) {
        const replicator = await harness.plugin.core.services.replicator.getActiveReplicator();
        if (!(replicator instanceof LiveSyncTrysteroReplicator)) {
            throw new Error("Replicator is not an instance of LiveSyncTrysteroReplicator");
        }
        const knownPeers = replicator.knownAdvertisements;

        const targetPeer = knownPeers.find((peer) => peer.name.startsWith("vault-host")) ?? knownPeers[0] ?? undefined;
        if (!targetPeer) {
            throw new Error("No connected P2P peer to synchronise with");
        }

        const p = replicator.sync(targetPeer.peerId, true);
        const result = await waitTaskWithFollowups(p, () => Promise.resolve(), P2P_REPLICATION_TIMEOUT_MS, 500);
        if (result && typeof result === "object" && "error" in result && result.error) {
            throw result.error;
        }
        return result;
    }

    return await harness.plugin.core.services.replication.replicate(true);
}

export async function closeReplication(harness: LiveSyncHarness) {
    if (harness.plugin.core.settings.remoteType === RemoteTypes.REMOTE_P2P) {
        return await closeP2PReplicatorConnections(harness);
    }
    const replicator = await harness.plugin.core.services.replicator.getActiveReplicator();
    if (!replicator) {
        console.log("No active replicator to close");
        return;
    }
    await replicator.closeReplication();
    await waitForIdle(harness);
    console.log("Replication closed");
}

export async function prepareRemote(harness: LiveSyncHarness, setting: ObsidianLiveSyncSettings, shouldReset = false) {
    // P2P has no remote database to initialise — skip
    if (setting.remoteType === RemoteTypes.REMOTE_P2P) return;

    if (shouldReset) {
        await delay(1000);
        await harness.plugin.core.services.replicator
            .getActiveReplicator()
            ?.tryResetRemoteDatabase(harness.plugin.core.settings);
    } else {
        await harness.plugin.core.services.replicator
            .getActiveReplicator()
            ?.tryCreateRemoteDatabase(harness.plugin.core.settings);
    }
    await harness.plugin.core.services.replicator
        .getActiveReplicator()
        ?.markRemoteResolved(harness.plugin.core.settings);
    const status = await harness.plugin.core.services.replicator
        .getActiveReplicator()
        ?.getRemoteStatus(harness.plugin.core.settings);
    console.log("Remote status:", status);
    expect(status).not.toBeFalsy();
}
