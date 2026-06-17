import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { applyP2pSettings, applyP2pTestTweaks, initSettingsFile } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import {
    discoverPeer,
    maybeStartLocalRelay,
    stopLocalRelayIfStarted,
    maybeStartCoturn,
    stopCoturnIfStarted,
} from "./helpers/p2p.ts";
import { jsonStringField, runCliOrFail, runCliWithInputOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { getOptimalLoopbackIp } from "./helpers/net.ts";

Deno.test("p2p: three nodes detect and resolve conflicts", async () => {
    const loopbackIp = await getOptimalLoopbackIp();
    const loopbackHost = loopbackIp === "::1" ? "[::1]" : loopbackIp;

    const relay = Deno.env.get("RELAY") ?? `ws://${loopbackHost}:4000/`;
    const roomId = Deno.env.get("ROOM_ID") ?? `room-${Date.now()}`;
    const passphrase = Deno.env.get("PASSPHRASE") ?? "test";
    const appId = "self-hosted-livesync-cli-tests";
    const peersTimeout = Number(Deno.env.get("PEERS_TIMEOUT") ?? "10");
    const syncTimeout = Number(Deno.env.get("SYNC_TIMEOUT") ?? "15");
    const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const hostPeerName = Deno.env.get("HOST_PEER_NAME") ?? `p2p-host-${nonce}`;
    const peerNameB = Deno.env.get("PEER_NAME_B") ?? `p2p-client-b-${nonce}`;
    const peerNameC = Deno.env.get("PEER_NAME_C") ?? `p2p-client-c-${nonce}`;
    const useCoturn = Deno.env.get("LIVESYNC_USE_COTURN") !== "0";
    const turnServers = Deno.env.get("TURN_SERVERS") ?? (useCoturn ? `turn:${loopbackHost}:3478` : "none");

    await using workDir = await TempDir.create("livesync-cli-p2p-3nodes");
    const vaultA = workDir.join("vault-a");
    const vaultB = workDir.join("vault-b");
    const vaultC = workDir.join("vault-c");
    const settingsA = workDir.join("settings-a.json");
    const settingsB = workDir.join("settings-b.json");
    const settingsC = workDir.join("settings-c.json");
    await Deno.mkdir(vaultA, { recursive: true });
    await Deno.mkdir(vaultB, { recursive: true });
    await Deno.mkdir(vaultC, { recursive: true });

    const relayStarted = await maybeStartLocalRelay(relay);
    const coturnStarted = await maybeStartCoturn(turnServers);
    try {
        await initSettingsFile(settingsA);
        await initSettingsFile(settingsB);
        await initSettingsFile(settingsC);
        await applyP2pSettings(settingsA, roomId, passphrase, appId, relay, "~.*", turnServers);
        await applyP2pSettings(settingsB, roomId, passphrase, appId, relay, "~.*", turnServers);
        await applyP2pSettings(settingsC, roomId, passphrase, appId, relay, "~.*", turnServers);
        await applyP2pTestTweaks(settingsA, hostPeerName, passphrase);
        await applyP2pTestTweaks(settingsB, peerNameB, passphrase);
        await applyP2pTestTweaks(settingsC, peerNameC, passphrase);

        const host = startCliInBackground(vaultA, "--settings", settingsA, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            const peerFromB = await discoverPeer(vaultB, settingsB, peersTimeout, hostPeerName);
            const peerFromC = await discoverPeer(vaultC, settingsC, peersTimeout, hostPeerName);
            const targetPath = "p2p/conflicted-from-two-clients.txt";

            await runCliWithInputOrFail("from-client-b-v1\n", vaultB, "--settings", settingsB, "put", targetPath);
            await runCliOrFail(vaultB, "--settings", settingsB, "p2p-sync", peerFromB.id, String(syncTimeout));
            await runCliOrFail(vaultC, "--settings", settingsC, "p2p-sync", peerFromC.id, String(syncTimeout));

            let visibleOnC = "";
            for (let i = 0; i < 5; i++) {
                try {
                    visibleOnC = sanitiseCatStdout(
                        await runCliOrFail(vaultC, "--settings", settingsC, "cat", targetPath)
                    ).trimEnd();
                    if (visibleOnC === "from-client-b-v1") break;
                } catch {
                    // retry below
                }
                await runCliOrFail(vaultC, "--settings", settingsC, "p2p-sync", peerFromC.id, String(syncTimeout));
            }
            assert(visibleOnC === "from-client-b-v1", `C should see file created by B, got: ${visibleOnC}`);

            await runCliWithInputOrFail("from-client-b-v2\n", vaultB, "--settings", settingsB, "put", targetPath);
            await runCliWithInputOrFail("from-client-c-v2\n", vaultC, "--settings", settingsC, "put", targetPath);

            const [syncB, syncC] = await Promise.all([
                runCliOrFail(vaultB, "--settings", settingsB, "p2p-sync", peerFromB.id, String(syncTimeout)),
                runCliOrFail(vaultC, "--settings", settingsC, "p2p-sync", peerFromC.id, String(syncTimeout)),
            ]);
            void syncB;
            void syncC;

            await runCliOrFail(vaultB, "--settings", settingsB, "p2p-sync", peerFromB.id, String(syncTimeout));
            await runCliOrFail(vaultC, "--settings", settingsC, "p2p-sync", peerFromC.id, String(syncTimeout));

            const infoBBefore = await runCliOrFail(vaultB, "--settings", settingsB, "info", targetPath);
            const conflictsBBefore = jsonStringField(infoBBefore, "conflicts");
            const keepRevB = jsonStringField(infoBBefore, "revision");
            assert(
                conflictsBBefore !== "N/A" && conflictsBBefore.length > 0,
                `expected conflicts on B\n${infoBBefore}`
            );
            assert(keepRevB.length > 0, `could not read revision on B\n${infoBBefore}`);

            const infoCBefore = await runCliOrFail(vaultC, "--settings", settingsC, "info", targetPath);
            const conflictsCBefore = jsonStringField(infoCBefore, "conflicts");
            const keepRevC = jsonStringField(infoCBefore, "revision");
            assert(
                conflictsCBefore !== "N/A" && conflictsCBefore.length > 0,
                `expected conflicts on C\n${infoCBefore}`
            );
            assert(keepRevC.length > 0, `could not read revision on C\n${infoCBefore}`);

            await runCliOrFail(vaultB, "--settings", settingsB, "resolve", targetPath, keepRevB);
            await runCliOrFail(vaultC, "--settings", settingsC, "resolve", targetPath, keepRevC);

            const infoBAfter = await runCliOrFail(vaultB, "--settings", settingsB, "info", targetPath);
            const infoCAfter = await runCliOrFail(vaultC, "--settings", settingsC, "info", targetPath);
            assert(jsonStringField(infoBAfter, "conflicts") === "N/A", `conflict still remains on B\n${infoBAfter}`);
            assert(jsonStringField(infoCAfter, "conflicts") === "N/A", `conflict still remains on C\n${infoCAfter}`);

            const finalContentB = sanitiseCatStdout(
                await runCliOrFail(vaultB, "--settings", settingsB, "cat", targetPath)
            ).trimEnd();
            const finalContentC = sanitiseCatStdout(
                await runCliOrFail(vaultC, "--settings", settingsC, "cat", targetPath)
            ).trimEnd();
            assert(
                finalContentB === "from-client-b-v2" || finalContentB === "from-client-c-v2",
                `unexpected final content on B: ${finalContentB}`
            );
            assert(
                finalContentC === "from-client-b-v2" || finalContentC === "from-client-c-v2",
                `unexpected final content on C: ${finalContentC}`
            );
        } finally {
            await host.stop();
        }
    } finally {
        await stopLocalRelayIfStarted(relayStarted);
        await stopCoturnIfStarted(coturnStarted);
    }
});
