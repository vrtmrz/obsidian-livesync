import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { initSettingsFile, applyP2pSettings } from "./helpers/settings.ts";
import { startP2pRelay, stopP2pRelay, isLocalP2pRelay } from "./helpers/docker.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";

Deno.test("p2p-host: starts and becomes ready", async () => {
    const relay = Deno.env.get("RELAY") ?? "ws://localhost:4000/";
    const roomId = Deno.env.get("ROOM_ID") ?? `room-${Date.now()}`;
    const passphrase = Deno.env.get("PASSPHRASE") ?? "test";
    const appId = Deno.env.get("APP_ID") ?? "self-hosted-livesync-cli-tests";
    const useInternalRelay = Deno.env.get("USE_INTERNAL_RELAY") !== "0";

    await using workDir = await TempDir.create("livesync-cli-p2p-host");
    const vaultDir = workDir.join("vault-host");
    const settingsFile = workDir.join("settings-host.json");
    await Deno.mkdir(vaultDir, { recursive: true });

    let relayStarted = false;
    if (useInternalRelay && isLocalP2pRelay(relay)) {
        await startP2pRelay();
        relayStarted = true;
    }

    try {
        await initSettingsFile(settingsFile);
        await applyP2pSettings(settingsFile, roomId, passphrase, appId, relay);
        const host = startCliInBackground(vaultDir, "--settings", settingsFile, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            assert(host.combined.includes("P2P host is running"));
        } finally {
            await host.stop();
        }
    } finally {
        if (relayStarted) {
            await stopP2pRelay().catch(() => {});
        }
    }
});
