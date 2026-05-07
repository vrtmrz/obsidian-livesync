import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { initSettingsFile, applyP2pSettings, applyP2pTestTweaks } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import { discoverPeer, maybeStartLocalRelay, stopLocalRelayIfStarted } from "./helpers/p2p.ts";
import { runCli } from "./helpers/cli.ts";

Deno.test("p2p-sync: discovers peer and completes sync", async () => {
    const relay = Deno.env.get("RELAY") ?? "ws://localhost:4000/";
    const roomId = Deno.env.get("ROOM_ID") ?? `room-${Date.now()}`;
    const passphrase = Deno.env.get("PASSPHRASE") ?? "test";
    const peersTimeout = Number(Deno.env.get("PEERS_TIMEOUT") ?? "12");
    const syncTimeout = Number(Deno.env.get("SYNC_TIMEOUT") ?? "15");

    await using workDir = await TempDir.create("livesync-cli-p2p-sync");
    const hostVault = workDir.join("vault-host");
    const hostSettings = workDir.join("settings-host.json");
    const clientVault = workDir.join("vault-sync");
    const clientSettings = workDir.join("settings-sync.json");
    await Deno.mkdir(hostVault, { recursive: true });
    await Deno.mkdir(clientVault, { recursive: true });

    const relayStarted = await maybeStartLocalRelay(relay);
    try {
        await initSettingsFile(hostSettings);
        await initSettingsFile(clientSettings);
        await applyP2pSettings(hostSettings, roomId, passphrase, "self-hosted-livesync-cli-tests", relay);
        await applyP2pSettings(clientSettings, roomId, passphrase, "self-hosted-livesync-cli-tests", relay);
        await applyP2pTestTweaks(hostSettings, "p2p-host", passphrase);
        await applyP2pTestTweaks(clientSettings, "p2p-client", passphrase);

        const host = startCliInBackground(hostVault, "--settings", hostSettings, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            const peer = await discoverPeer(
                clientVault,
                clientSettings,
                peersTimeout,
                Deno.env.get("TARGET_PEER") ?? undefined
            );
            const syncResult = await runCli(
                clientVault,
                "--settings",
                clientSettings,
                "p2p-sync",
                peer.id,
                String(syncTimeout)
            );
            assert(
                syncResult.code === 0,
                `p2p-sync failed\nstdout: ${syncResult.stdout}\nstderr: ${syncResult.stderr}`
            );
        } finally {
            await host.stop();
        }
    } finally {
        await stopLocalRelayIfStarted(relayStarted);
    }
});
