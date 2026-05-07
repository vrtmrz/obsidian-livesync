import { runCli } from "./cli.ts";
import { isLocalP2pRelay, startP2pRelay, stopP2pRelay } from "./docker.ts";

export type PeerEntry = {
    id: string;
    name: string;
};

export function parsePeerLines(output: string): PeerEntry[] {
    return output
        .split(/\r?\n/)
        .map((line) => line.split("\t"))
        .filter((parts) => parts.length >= 3 && parts[0] === "[peer]")
        .map((parts) => ({ id: parts[1], name: parts[2] }));
}

export async function discoverPeer(
    vaultDir: string,
    settingsFile: string,
    timeoutSeconds: number,
    targetPeer?: string
): Promise<PeerEntry> {
    const result = await runCli(vaultDir, "--settings", settingsFile, "p2p-peers", String(timeoutSeconds));
    if (result.code !== 0) {
        throw new Error(`p2p-peers failed\n${result.combined}`);
    }
    const peers = parsePeerLines(result.stdout);
    if (targetPeer) {
        const matched = peers.find((peer) => peer.id === targetPeer || peer.name === targetPeer);
        if (matched) return matched;
    }
    if (peers.length === 0) {
        const fallback = result.combined.match(/Advertisement from\s+([^\s]+)/);
        if (fallback?.[1]) {
            return { id: fallback[1], name: fallback[1] };
        }
        throw new Error(`No peers discovered\n${result.combined}`);
    }
    return peers[0];
}

export async function maybeStartLocalRelay(relay: string): Promise<boolean> {
    if (!isLocalP2pRelay(relay)) return false;
    await startP2pRelay();
    return true;
}

export async function stopLocalRelayIfStarted(started: boolean): Promise<void> {
    if (started) {
        await stopP2pRelay().catch(() => {});
    }
}
