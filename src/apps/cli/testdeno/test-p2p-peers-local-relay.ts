import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { initSettingsFile, applyP2pSettings, applyP2pTestTweaks } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import {
    discoverPeer,
    maybeStartLocalRelay,
    stopLocalRelayIfStarted,
    maybeStartCoturn,
    stopCoturnIfStarted,
} from "./helpers/p2p.ts";
import { getOptimalLoopbackIp } from "./helpers/net.ts";

Deno.test("p2p-peers: discovers host through local relay", async () => {
    const loopbackIp = await getOptimalLoopbackIp();
    const loopbackHost = loopbackIp === "::1" ? "[::1]" : loopbackIp;

    const relay = Deno.env.get("RELAY") ?? `ws://${loopbackHost}:4000/`;
    const roomId = Deno.env.get("ROOM_ID") ?? `room-${Date.now()}`;
    const passphrase = Deno.env.get("PASSPHRASE") ?? "test";
    const timeoutSeconds = Number(Deno.env.get("TIMEOUT_SECONDS") ?? "8");
    const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const hostPeerName = Deno.env.get("HOST_PEER_NAME") ?? `p2p-host-${nonce}`;
    const clientPeerName = Deno.env.get("CLIENT_PEER_NAME") ?? `p2p-client-${nonce}`;
    const useCoturn = Deno.env.get("LIVESYNC_USE_COTURN") !== "0";
    const turnServers = Deno.env.get("TURN_SERVERS") ?? (useCoturn ? `turn:${loopbackHost}:3478` : "none");

    await using workDir = await TempDir.create("livesync-cli-p2p-peers-local-relay");
    const hostVault = workDir.join("vault-host");
    const hostSettings = workDir.join("settings-host.json");
    const clientVault = workDir.join("vault");
    const clientSettings = workDir.join("settings.json");
    await Deno.mkdir(hostVault, { recursive: true });
    await Deno.mkdir(clientVault, { recursive: true });

    const relayStarted = await maybeStartLocalRelay(relay);
    const coturnStarted = await maybeStartCoturn(turnServers);
    try {
        await initSettingsFile(hostSettings);
        await initSettingsFile(clientSettings);
        await applyP2pSettings(
            hostSettings,
            roomId,
            passphrase,
            "self-hosted-livesync-cli-tests",
            relay,
            "~.*",
            turnServers
        );
        await applyP2pSettings(
            clientSettings,
            roomId,
            passphrase,
            "self-hosted-livesync-cli-tests",
            relay,
            "~.*",
            turnServers
        );
        await applyP2pTestTweaks(hostSettings, hostPeerName, passphrase);
        await applyP2pTestTweaks(clientSettings, clientPeerName, passphrase);

        const host = startCliInBackground(hostVault, "--settings", hostSettings, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            const peer = await discoverPeer(clientVault, clientSettings, timeoutSeconds, hostPeerName);
            assert(peer.id.length > 0);
            assert(peer.name.length > 0);
            assert(peer.name === hostPeerName, `expected peer '${hostPeerName}', got '${peer.name}'`);
        } finally {
            await host.stop();
        }
    } finally {
        await stopLocalRelayIfStarted(relayStarted);
        await stopCoturnIfStarted(coturnStarted);
    }
});
