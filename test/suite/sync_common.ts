import { expect } from "vitest";
import { waitForIdle, type LiveSyncHarness } from "../harness/harness";
import { LOG_LEVEL_INFO, RemoteTypes, type ObsidianLiveSyncSettings } from "@/lib/src/common/types";

import { delay, fireAndForget } from "@/lib/src/common/utils";
import { commands } from "vitest/browser";
import { LiveSyncTrysteroReplicator } from "@/lib/src/replication/trystero/LiveSyncTrysteroReplicator";
import { waitTaskWithFollowups } from "../lib/util";
async function waitForP2PPeers(harness: LiveSyncHarness) {
    if (harness.plugin.settings.remoteType === RemoteTypes.REMOTE_P2P) {
        // Wait for peers to connect
        const maxRetries = 20;
        let retries = maxRetries;
        const replicator = await harness.plugin.services.replicator.getActiveReplicator();
        if (!(replicator instanceof LiveSyncTrysteroReplicator)) {
            throw new Error("Replicator is not an instance of LiveSyncTrysteroReplicator");
        }
        const p2pReplicator = await replicator.getP2PConnection(LOG_LEVEL_INFO);
        if (!p2pReplicator) {
            throw new Error("P2P Replicator is not initialized");
        }
        while (retries-- > 0) {
            fireAndForget(() => commands.acceptWebPeer());
            await delay(1000);
            const peers = p2pReplicator.knownAdvertisements;

            if (peers && peers.length > 0) {
                console.log("P2P peers connected:", peers);
                return;
            }
            fireAndForget(() => commands.acceptWebPeer());
            console.log(`Waiting for any P2P peers to be connected... ${maxRetries - retries}/${maxRetries}`);
            console.dir(peers);
            await delay(1000);
        }
        console.log("Failed to connect P2P peers after retries");
        throw new Error("P2P peers did not connect in time.");
    }
}
export async function closeP2PReplicatorConnections(harness: LiveSyncHarness) {
    if (harness.plugin.settings.remoteType === RemoteTypes.REMOTE_P2P) {
        const replicator = await harness.plugin.services.replicator.getActiveReplicator();
        if (!(replicator instanceof LiveSyncTrysteroReplicator)) {
            throw new Error("Replicator is not an instance of LiveSyncTrysteroReplicator");
        }
        replicator.closeReplication();
        await delay(30);
        replicator.closeReplication();
        await delay(1000);
        console.log("P2P replicator connections closed");
        // if (replicator instanceof LiveSyncTrysteroReplicator) {
        //     replicator.closeReplication();
        //     await delay(1000);
        // }
    }
}

export async function performReplication(harness: LiveSyncHarness) {
    await waitForP2PPeers(harness);
    await delay(500);
    const p = harness.plugin.services.replication.replicate(true);
    const task =
        harness.plugin.settings.remoteType === RemoteTypes.REMOTE_P2P
            ? waitTaskWithFollowups(
                  p,
                  () => {
                      // Accept any peer dialogs during replication (fire and forget)
                      fireAndForget(() => commands.acceptWebPeer());
                      return Promise.resolve();
                  },
                  30000,
                  500
              )
            : p;
    const result = await task;
    // await waitForIdle(harness);
    // if (harness.plugin.settings.remoteType === RemoteTypes.REMOTE_P2P) {
    //     await closeP2PReplicatorConnections(harness);
    // }
    return result;
}

export async function closeReplication(harness: LiveSyncHarness) {
    if (harness.plugin.settings.remoteType === RemoteTypes.REMOTE_P2P) {
        return await closeP2PReplicatorConnections(harness);
    }
    const replicator = await harness.plugin.services.replicator.getActiveReplicator();
    if (!replicator) {
        console.log("No active replicator to close");
        return;
    }
    await replicator.closeReplication();
    await waitForIdle(harness);
    console.log("Replication closed");
}

export async function prepareRemote(harness: LiveSyncHarness, setting: ObsidianLiveSyncSettings, shouldReset = false) {
    if (setting.remoteType !== RemoteTypes.REMOTE_P2P) {
        if (shouldReset) {
            await delay(1000);
            await harness.plugin.services.replicator
                .getActiveReplicator()
                ?.tryResetRemoteDatabase(harness.plugin.settings);
        } else {
            await harness.plugin.services.replicator
                .getActiveReplicator()
                ?.tryCreateRemoteDatabase(harness.plugin.settings);
        }
        await harness.plugin.services.replicator.getActiveReplicator()?.markRemoteResolved(harness.plugin.settings);
        // No exceptions should be thrown
        const status = await harness.plugin.services.replicator
            .getActiveReplicator()
            ?.getRemoteStatus(harness.plugin.settings);
        console.log("Remote status:", status);
        expect(status).not.toBeFalsy();
    }
}
