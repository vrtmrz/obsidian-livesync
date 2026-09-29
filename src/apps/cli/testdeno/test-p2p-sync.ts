import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import {
    initSettingsFile,
    applyP2pSettings,
    applyP2pTestTweaks,
    generateSetupUriFromSettings,
} from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import {
    discoverPeer,
    maybeStartLocalRelay,
    stopLocalRelayIfStarted,
    maybeStartCoturn,
    stopCoturnIfStarted,
} from "./helpers/p2p.ts";
import { runCli, runCliOrFail, runCliWithInputOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { getOptimalLoopbackIp } from "./helpers/net.ts";

Deno.test("p2p-sync: transfers with the same ID key and rejects a different document ID key", async () => {
    const loopbackIp = await getOptimalLoopbackIp();
    const loopbackHost = loopbackIp === "::1" ? "[::1]" : loopbackIp;

    const relay = Deno.env.get("RELAY") ?? `ws://${loopbackHost}:4000/`;
    const roomId = Deno.env.get("ROOM_ID") ?? `room-${Date.now()}`;
    const passphrase = Deno.env.get("PASSPHRASE") ?? "test";
    const peersTimeout = Number(Deno.env.get("PEERS_TIMEOUT") ?? "12");
    const syncTimeout = Number(Deno.env.get("SYNC_TIMEOUT") ?? "15");
    const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const hostPeerName = Deno.env.get("HOST_PEER_NAME") ?? `p2p-host-${nonce}`;
    const clientPeerName = Deno.env.get("CLIENT_PEER_NAME") ?? `p2p-client-${nonce}`;
    const useCoturn = Deno.env.get("LIVESYNC_USE_COTURN") !== "0";
    const turnServers = Deno.env.get("TURN_SERVERS") ?? (useCoturn ? `turn:${loopbackHost}:3478` : "none");

    await using workDir = await TempDir.create("livesync-cli-p2p-sync");
    const hostVault = workDir.join("vault-host");
    const hostSettings = workDir.join("settings-host.json");
    const clientVault = workDir.join("vault-sync");
    const clientSettings = workDir.join("settings-sync.json");
    const rejectedVault = workDir.join("vault-rejected");
    const rejectedSettings = workDir.join("settings-rejected.json");
    await Deno.mkdir(hostVault, { recursive: true });
    await Deno.mkdir(clientVault, { recursive: true });
    await Deno.mkdir(rejectedVault, { recursive: true });

    const relayStarted = await maybeStartLocalRelay(relay);
    const coturnStarted = await maybeStartCoturn(turnServers);
    try {
        await initSettingsFile(hostSettings);
        await initSettingsFile(clientSettings);
        await initSettingsFile(rejectedSettings);
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
        await applyP2pSettings(
            rejectedSettings,
            roomId,
            passphrase,
            "self-hosted-livesync-cli-tests",
            relay,
            "~.*",
            turnServers
        );
        await applyP2pTestTweaks(hostSettings, hostPeerName, passphrase);
        await applyP2pTestTweaks(clientSettings, clientPeerName, passphrase);
        await applyP2pTestTweaks(rejectedSettings, "p2p-rejected-" + nonce, passphrase);
        for (const [vault, path, key, label] of [
            [hostVault, hostSettings, "ab".repeat(32), "host"],
            [clientVault, clientSettings, "ab".repeat(32), "client"],
            [rejectedVault, rejectedSettings, "cd".repeat(32), "rejected"],
        ]) {
            const settings = JSON.parse(await Deno.readTextFile(path));
            settings.idDerivationVersion = 1;
            settings.idDerivationKey = key;
            const sourcePath = workDir.join("setup-source-" + label + ".json");
            await Deno.writeTextFile(sourcePath, JSON.stringify(settings));
            const setupPassphrase = "independent-id-setup-passphrase";
            const setupUri = await generateSetupUriFromSettings(sourcePath, setupPassphrase, true);
            await runCliWithInputOrFail(setupPassphrase + "\n", vault, "--settings", path, "setup", setupUri);
            const persisted = JSON.parse(await Deno.readTextFile(path));
            assert(persisted.idDerivationVersion === 1, "The Setup URI lost the ID derivation version.");
            assert(persisted.idDerivationKey === "", "The CLI stored the ID key in plain text.");
            assert(
                typeof persisted.encryptedIdDerivationKey === "string" && persisted.encryptedIdDerivationKey.length > 0,
                "The CLI did not encrypt the saved ID key."
            );
            assert(persisted.P2P_Enabled === true, "The Setup URI disabled P2P.");
            assert(persisted.P2P_roomID === roomId, "The Setup URI changed the P2P room.");
            assert(persisted.P2P_relays === relay, "The Setup URI changed the P2P relay.");
            assert(persisted.remoteType === "ONLY_P2P", "The Setup URI changed the remote type.");
        }
        const notePath = "p2p/independent-id-note.md";
        await runCliWithInputOrFail(
            "A note transferred with the saved ID key.\n",
            clientVault,
            "--settings",
            clientSettings,
            "put",
            notePath
        );

        const host = startCliInBackground(hostVault, "--settings", hostSettings, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            const peer = await discoverPeer(
                clientVault,
                clientSettings,
                peersTimeout,
                Deno.env.get("TARGET_PEER") ?? hostPeerName
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
            const rejectedPeer = await discoverPeer(rejectedVault, rejectedSettings, peersTimeout, hostPeerName);
            const rejectedSync = await runCli(
                rejectedVault,
                "--settings",
                rejectedSettings,
                "p2p-sync",
                rejectedPeer.id,
                String(syncTimeout)
            );
            assert(
                rejectedSync.code !== 0,
                `P2P accepted a different key for obfuscated document IDs.\nstdout: ${rejectedSync.stdout}\nstderr: ${rejectedSync.stderr}`
            );
            assert(
                rejectedSync.combined.includes("Tweak values are not matched"),
                `P2P failed before checking peer settings.\nstdout: ${rejectedSync.stdout}\nstderr: ${rejectedSync.stderr}`
            );
        } finally {
            await host.stop();
        }
        const received = sanitiseCatStdout(
            await runCliOrFail(hostVault, "--settings", hostSettings, "cat", notePath)
        ).trimEnd();
        assert(received === "A note transferred with the saved ID key.", "The host did not receive the keyed note.");
        const rejectedRead = await runCli(rejectedVault, "--settings", rejectedSettings, "cat", notePath);
        assert(rejectedRead.code !== 0, "The rejected device received the keyed note.");
    } finally {
        await stopLocalRelayIfStarted(relayStarted);
        await stopCoturnIfStarted(coturnStarted);
    }
});
