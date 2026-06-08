import { runCli } from "./cli.ts";
import { isLocalP2pRelay, startP2pRelay, stopP2pRelay, startCoturn, stopCoturn } from "./docker.ts";
import { waitForPort } from "./net.ts";

export type PeerEntry = {
    id: string;
    name: string;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRelayEndpoint(relay: string): { hostname: string; port: number } {
    const url = new URL(relay);
    const port = url.port ? Number(url.port) : url.protocol === "ws:" ? 80 : url.protocol === "wss:" ? 443 : NaN;
    if (!Number.isFinite(port)) {
        throw new Error(`Unsupported relay URL: ${relay}`);
    }
    const hostname = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
    return { hostname, port };
}

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
    const retries = Math.max(0, Number(Deno.env.get("LIVESYNC_P2P_PEERS_RETRY") ?? "3"));
    let lastCombined = "";

    for (let attempt = 0; attempt <= retries; attempt++) {
        const result = await runCli(vaultDir, "--settings", settingsFile, "p2p-peers", String(timeoutSeconds));
        lastCombined = result.combined;

        if (result.code === 0) {
            const peers = parsePeerLines(result.stdout);
            if (targetPeer) {
                const matched = peers.find((peer) => peer.id === targetPeer || peer.name === targetPeer);
                if (matched) return matched;
            }
            if (peers.length > 0) {
                return peers[0];
            }

            const fallback = result.combined.match(/Advertisement from\s+([^\s]+)/);
            if (fallback?.[1]) {
                return { id: fallback[1], name: fallback[1] };
            }
        }

        if (attempt < retries) {
            const waitMs = 400 * (attempt + 1);
            console.warn(
                `[WARN] p2p-peers returned no usable peers, retrying (${attempt + 1}/${retries}) in ${waitMs}ms`
            );
            await sleep(waitMs);
            continue;
        }

        throw new Error(
            result.code !== 0 ? `p2p-peers failed\n${result.combined}` : `No peers discovered\n${result.combined}`
        );
    }

    throw new Error(`No peers discovered\n${lastCombined}`);
}

export async function maybeStartLocalRelay(relay: string): Promise<boolean> {
    if (!isLocalP2pRelay(relay)) return false;
    await startP2pRelay();
    const endpoint = parseRelayEndpoint(relay);
    await waitForPort(endpoint.hostname, endpoint.port, {
        timeoutMs: Number(Deno.env.get("LIVESYNC_P2P_RELAY_READY_TIMEOUT_MS") ?? "15000"),
        intervalMs: Number(Deno.env.get("LIVESYNC_P2P_RELAY_READY_INTERVAL_MS") ?? "250"),
        connectTimeoutMs: Number(Deno.env.get("LIVESYNC_P2P_RELAY_CONNECT_TIMEOUT_MS") ?? "1000"),
    });
    // Docker proxy accepts TCP connections instantly before the container's internal process is fully ready.
    // Wait an additional few seconds to ensure strfry is actually accepting WebSockets.
    await sleep(3000);
    return true;
}

export async function stopLocalRelayIfStarted(started: boolean): Promise<void> {
    if (started) {
        await stopP2pRelay().catch(() => {});
    }
}

export async function maybeStartCoturn(turnServers: string): Promise<boolean> {
    if (turnServers.includes("localhost") || turnServers.includes("127.0.0.1") || turnServers.includes("[::1]")) {
        await startCoturn();
        return true;
    }
    return false;
}

export async function stopCoturnIfStarted(started: boolean): Promise<void> {
    if (started) {
        await stopCoturn().catch(() => {});
    }
}
