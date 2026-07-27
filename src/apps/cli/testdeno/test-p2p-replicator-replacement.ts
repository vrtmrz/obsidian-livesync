import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { TempDir } from "./helpers/temp.ts";
import { initSettingsFile, applyP2pSettings, applyP2pTestTweaks } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import { maybeStartLocalRelay, stopLocalRelayIfStarted, maybeStartCoturn, stopCoturnIfStarted } from "./helpers/p2p.ts";
import { CLI_DIR, runCli, sanitiseCatStdout } from "./helpers/cli.ts";

const NOTE_PATH = "p2p-replicator-replacement.md";
const NOTE_CONTENT = "Replicated after replacing the active P2P replicator.";

async function runReplacementProbe(
    vaultPath: string,
    settingsPath: string,
    targetPeer: string,
    timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
    const command = new Deno.Command("node", {
        args: [
            join(CLI_DIR, "dist", "p2p-lifecycle-test.cjs"),
            vaultPath,
            "--settings",
            settingsPath,
            "p2p-sync",
            targetPeer,
            String(timeoutMs / 1000),
            NOTE_PATH,
            NOTE_CONTENT,
        ],
        cwd: CLI_DIR,
        stdout: "piped",
        stderr: "piped",
    });
    const result = await command.output();
    return {
        code: result.code,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
    };
}

Deno.test("p2p lifecycle: replacement keeps real CLI communication on the current replicator", async () => {
    const relay = Deno.env.get("RELAY") ?? "ws://localhost:4000/";
    const peersTimeout = Number(Deno.env.get("PEERS_TIMEOUT") ?? "20");
    const syncTimeout = Number(Deno.env.get("SYNC_TIMEOUT") ?? "60");
    const probeTimeoutMs = Math.max(peersTimeout, syncTimeout) * 1000;
    const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const roomId = Deno.env.get("ROOM_ID") ?? `replacement-room-${nonce}`;
    const passphrase = Deno.env.get("PASSPHRASE") ?? `replacement-pass-${nonce}`;
    const appId = "self-hosted-livesync-cli-replacement-test";
    const hostPeerName = `p2p-replacement-host-${nonce}`;
    const probePeerName = `p2p-replacement-probe-${nonce}`;
    const verifierPeerName = `p2p-replacement-verifier-${nonce}`;
    const useCoturn = Deno.env.get("LIVESYNC_USE_COTURN") !== "0";
    const turnServers = Deno.env.get("TURN_SERVERS") ?? (useCoturn ? "turn:127.0.0.1:3478" : "none");

    await using workDir = await TempDir.create("livesync-cli-p2p-replacement");
    const hostVault = workDir.join("vault-host");
    const probeVault = workDir.join("vault-probe");
    const verifierVault = workDir.join("vault-verifier");
    const hostSettings = workDir.join("settings-host.json");
    const probeSettings = workDir.join("settings-probe.json");
    const verifierSettings = workDir.join("settings-verifier.json");
    await Promise.all([
        Deno.mkdir(hostVault, { recursive: true }),
        Deno.mkdir(probeVault, { recursive: true }),
        Deno.mkdir(verifierVault, { recursive: true }),
    ]);

    const relayStarted = await maybeStartLocalRelay(relay);
    const coturnStarted = await maybeStartCoturn(turnServers);
    try {
        for (const settingsPath of [hostSettings, probeSettings, verifierSettings]) {
            await initSettingsFile(settingsPath);
            await applyP2pSettings(settingsPath, roomId, passphrase, appId, relay, "~.*", turnServers);
        }
        await applyP2pTestTweaks(hostSettings, hostPeerName, passphrase);
        await applyP2pTestTweaks(probeSettings, probePeerName, passphrase);
        await applyP2pTestTweaks(verifierSettings, verifierPeerName, passphrase);

        const host = startCliInBackground(hostVault, "--settings", hostSettings, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            const probe = await runReplacementProbe(probeVault, probeSettings, hostPeerName, probeTimeoutMs);
            assert(
                probe.code === 0,
                `P2P replacement probe failed\nstdout: ${probe.stdout}\nstderr: ${probe.stderr}`
            );
            assertStringIncludes(probe.stdout, "[Probe] P2P replicator replaced");

            const syncResult = await runCli(
                verifierVault,
                "--settings",
                verifierSettings,
                "p2p-sync",
                hostPeerName,
                String(syncTimeout)
            );
            assert(
                syncResult.code === 0,
                `Verifier P2P sync failed\nstdout: ${syncResult.stdout}\nstderr: ${syncResult.stderr}`
            );

            const catResult = await runCli(verifierVault, "--settings", verifierSettings, "cat", NOTE_PATH);
            assert(
                catResult.code === 0,
                `Verifier could not read ${NOTE_PATH}\nstdout: ${catResult.stdout}\nstderr: ${catResult.stderr}`
            );
            assertEquals(sanitiseCatStdout(catResult.stdout).trim(), NOTE_CONTENT);
        } finally {
            await host.stop();
        }
    } finally {
        await stopLocalRelayIfStarted(relayStarted);
        await stopCoturnIfStarted(coturnStarted);
    }
});
