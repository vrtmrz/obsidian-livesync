import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import type { P2PServiceViews } from "@vrtmrz/livesync-commonlib/p2p";
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

type ProbeP2PService = Pick<P2PServiceViews, "transportLifecycle" | "peerDirectory" | "targetedTransfer">;

async function waitForServing(service: ProbeP2PService, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
        if (service.transportLifecycle.isConnected) return;
        await delay(200);
    }
    throw new Error("The stable P2P service did not start serving within the timeout");
}

async function waitForPeer(
    service: ProbeP2PService,
    targetPeer: string,
    timeoutMs: number
): Promise<{ peerId: string; name: string }> {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
        const peer = service.peerDirectory
            .getPeers()
            .find((candidate) => candidate.name === targetPeer || candidate.peerId === targetPeer);
        if (peer) return peer;
        await delay(200);
    }
    const knownPeers = service.peerDirectory
        .getPeers()
        .map((peer) => `${peer.name} (${peer.peerId})`)
        .join(", ");
    throw new Error(`Peer '${targetPeer}' was not discovered within the timeout. Known peers: ${knownPeers || "none"}`);
}

function assertPullSucceeded(result: unknown): void {
    if (result && typeof result === "object" && "error" in result && result.error) {
        throw new Error(`P2P pull failed: ${describeError(result.error)}`);
    }
}

async function communicateWithPeer(
    service: ProbeP2PService,
    targetPeer: string,
    timeoutMs: number
): Promise<{ peerId: string; name: string }> {
    if (!service.transportLifecycle.isConnected) {
        await service.transportLifecycle.connect();
    }
    await waitForServing(service, timeoutMs);
    const peer = await waitForPeer(service, targetPeer, timeoutMs);
    assertPullSucceeded(await service.targetedTransfer.pullFromPeer(peer.peerId, { showNotice: false }));
    const pushResult = await service.targetedTransfer.requestPushToPeer(peer.peerId);
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

    const initialActiveReplicator = core.services.replicator.getActiveReplicator();
    if (!initialActiveReplicator) {
        throw new Error("The CLI did not activate the initial P2P Replicator adapter");
    }
    const compatibilityFacade = p2pReplicator.replicator;
    const p2pService = await openP2PHost(core, p2pReplicator);

    const firstPeer = await communicateWithPeer(p2pService, targetPeer, timeoutMs);
    const initialised = await core.services.databaseEvents.initialiseDatabase(false, true, false);
    if (!initialised) {
        throw new Error("Database reinitialisation failed during the P2P replacement probe");
    }

    const replacementActiveReplicator = core.services.replicator.getActiveReplicator();
    if (!replacementActiveReplicator) {
        throw new Error("ReplicatorService did not activate a replacement P2P Replicator adapter");
    }
    if (replacementActiveReplicator === initialActiveReplicator) {
        throw new Error("Database reinitialisation retained the previous active P2P Replicator adapter");
    }
    if (p2pReplicator.replicator !== compatibilityFacade) {
        throw new Error("Database reinitialisation replaced the stable P2P service compatibility facade");
    }
    if (p2pService.transportLifecycle.isConnected) {
        throw new Error("Database reinitialisation left the database-bound P2P room open");
    }

    const settings = core.services.setting.currentSettings();
    settings.P2P_AutoStart = true;
    await core.services.control.applySettings();
    await waitForServing(p2pService, timeoutMs);
    if (p2pReplicator.replicator !== compatibilityFacade) {
        throw new Error("A setting event replaced the stable P2P service compatibility facade");
    }

    const encoded = new TextEncoder().encode(noteContent);
    const noteBody = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    const timestamp = Date.now();
    await core.serviceModules.storageAccess.writeFileAuto(notePath, noteBody, {
        ctime: timestamp,
        mtime: timestamp,
    });
    await core.serviceModules.fileHandler.storeFileToDB(notePath as FilePathWithPrefix, true);

    const replacementPeer = await communicateWithPeer(p2pService, targetPeer, timeoutMs);
    if (replacementPeer.name !== firstPeer.name) {
        throw new Error(
            `The replacement replicator reached '${replacementPeer.name}' instead of the original peer '${firstPeer.name}'`
        );
    }

    core.services.context.standardIo.writeStdout(
        `[Probe] The active P2P adapter was replaced, the stable service reopened, and ${notePath} was sent through it.\n`
    );
    return true;
}
