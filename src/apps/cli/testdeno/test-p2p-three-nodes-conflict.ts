import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { applyP2pSettings, initSettingsFile } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import { discoverPeer, maybeStartLocalRelay, stopLocalRelayIfStarted } from "./helpers/p2p.ts";
import { jsonStringField, runCliOrFail, runCliWithInputOrFail, sanitiseCatStdout } from "./helpers/cli.ts";

Deno.test("p2p: three nodes detect and resolve conflicts", async () => {
    const relay = Deno.env.get("RELAY") ?? "ws://localhost:4000/";
    const roomId = `${Deno.env.get("ROOM_ID_PREFIX") ?? "p2p-room"}-${Date.now()}`;
    const passphrase = `${Deno.env.get("PASSPHRASE_PREFIX") ?? "p2p-pass"}-${Date.now()}`;
    const appId = Deno.env.get("APP_ID") ?? "self-hosted-livesync-cli-tests";
    const peersTimeout = Number(Deno.env.get("PEERS_TIMEOUT") ?? "10");
    const syncTimeout = Number(Deno.env.get("SYNC_TIMEOUT") ?? "15");

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
    try {
        for (const settings of [settingsA, settingsB, settingsC]) {
            await initSettingsFile(settings);
            await applyP2pSettings(settings, roomId, passphrase, appId, relay);
        }

        const host = startCliInBackground(vaultA, "--settings", settingsA, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            const peerFromB = await discoverPeer(vaultB, settingsB, peersTimeout);
            const peerFromC = await discoverPeer(vaultC, settingsC, peersTimeout);
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
    }
});
