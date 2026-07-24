import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncTrysteroReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/LiveSyncTrysteroReplicator";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import type { CLICommandContext } from "@/apps/cli/commands/types";
import { openP2PHost } from "@/apps/cli/commands/p2p";

const DEFAULT_NOTE_PATH = "p2p-replicator-replacement.md";
const DEFAULT_NOTE_CONTENT = "Replicated after replacing the active P2P replicator.";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => compatGlobal.setTimeout(resolve, ms));
}

function describeError(value: unknown): string {
    return value instanceof Error ? (value.stack ?? value.message) : String(value);
}

async function waitForServing(replicator: LiveSyncTrysteroReplicator, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
        if (replicator.server?.isServing) return;
        await delay(200);
    }
    throw new Error("The replacement P2P replicator did not start serving within the timeout");
}

async function waitForPeer(
    replicator: LiveSyncTrysteroReplicator,
    targetPeer: string,
    timeoutMs: number
): Promise<{ peerId: string; name: string }> {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
        const peer = replicator.knownAdvertisements.find(
            (candidate) => candidate.name === targetPeer || candidate.peerId === targetPeer
        );
        if (peer) return peer;
        await delay(200);
    }
    const knownPeers = replicator.knownAdvertisements.map((peer) => `${peer.name} (${peer.peerId})`).join(", ");
    throw new Error(
        `Peer '${targetPeer}' was not discovered within the timeout. Known peers: ${knownPeers || "none"}`
    );
}

function assertPullSucceeded(result: unknown): void {
    if (result && typeof result === "object" && "error" in result && result.error) {
        throw new Error(`P2P pull failed: ${describeError(result.error)}`);
    }
}

async function communicateWithPeer(
    replicator: LiveSyncTrysteroReplicator,
    targetPeer: string,
    timeoutMs: number
): Promise<{ peerId: string; name: string }> {
    await replicator.open();
    await waitForServing(replicator, timeoutMs);
    const peer = await waitForPeer(replicator, targetPeer, timeoutMs);
    assertPullSucceeded(await replicator.replicateFrom(peer.peerId, false));
    const pushResult = await replicator.requestSynchroniseToPeer(peer.peerId);
    if (!pushResult || pushResult.ok !== true) {
        throw new Error(`P2P push failed: ${describeError(pushResult?.error)}`);
    }
    return peer;
}

/** Runs the real-transport lifecycle probe used by the Deno and Compose P2P suites. */
export async function runP2PReplicatorReplacementProbe(
    context: CLICommandContext,
    targetPeer: string,
    timeoutMs: number,
    notePath = DEFAULT_NOTE_PATH,
    noteContent = DEFAULT_NOTE_CONTENT
): Promise<boolean> {
    const { core, p2pReplicator } = context;
    if (!p2pReplicator) {
        throw new Error("The CLI did not expose its P2P service-feature result to the integration probe");
    }

    const firstReplicator = await openP2PHost(core);
    if (p2pReplicator.replicator !== firstReplicator) {
        throw new Error("The P2P service feature did not expose the newly created replicator");
    }

    const firstPeer = await communicateWithPeer(firstReplicator, targetPeer, timeoutMs);
    const initialised = await core.services.databaseEvents.initialiseDatabase(false, true, false);
    if (!initialised) {
        throw new Error("Database reinitialisation failed during the P2P replacement probe");
    }

    const replacementReplicator = p2pReplicator.replicator;
    if (core.services.replicator.getActiveReplicator() !== replacementReplicator) {
        throw new Error("ReplicatorService did not activate the P2P service feature's replacement replicator");
    }
    if (replacementReplicator === firstReplicator) {
        throw new Error("Database reinitialisation retained the previous P2P replicator instance");
    }
    if (firstReplicator.server !== undefined) {
        throw new Error("The previous P2P replicator remained open after replacement");
    }

    const settings = core.services.setting.currentSettings();
    settings.P2P_AutoStart = true;
    await core.services.control.applySettings();
    const resumedReplicator = p2pReplicator.replicator;
    await waitForServing(resumedReplicator, timeoutMs);
    if (firstReplicator.server !== undefined) {
        throw new Error("A setting event reopened the previous P2P replicator");
    }

    const encoded = new TextEncoder().encode(noteContent);
    const noteBody = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    const timestamp = Date.now();
    await core.serviceModules.storageAccess.writeFileAuto(notePath, noteBody, {
        ctime: timestamp,
        mtime: timestamp,
    });
    await core.serviceModules.fileHandler.storeFileToDB(notePath as FilePathWithPrefix, true);

    const replacementPeer = await communicateWithPeer(resumedReplicator, targetPeer, timeoutMs);
    if (replacementPeer.name !== firstPeer.name) {
        throw new Error(
            `The replacement replicator reached '${replacementPeer.name}' instead of the original peer '${firstPeer.name}'`
        );
    }

    core.services.context.standardIo.writeStdout(
        `[Probe] P2P replicator replaced, old transport stayed closed, and ${notePath} was sent through the replacement.\n`
    );
    return true;
}
