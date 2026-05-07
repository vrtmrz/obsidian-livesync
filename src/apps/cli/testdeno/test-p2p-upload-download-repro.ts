import { TempDir } from "./helpers/temp.ts";
import { applyP2pSettings, applyP2pTestTweaks, initSettingsFile } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import { discoverPeer, maybeStartLocalRelay, stopLocalRelayIfStarted } from "./helpers/p2p.ts";
import { assertFilesEqual, runCliOrFail } from "./helpers/cli.ts";

async function writeFilledFile(path: string, size: number, byte: number): Promise<void> {
    const data = new Uint8Array(size);
    data.fill(byte);
    await Deno.writeFile(path, data);
}

Deno.test("p2p: upload/download reproduction scenario", async () => {
    const relay = Deno.env.get("RELAY") ?? "ws://localhost:4000/";
    const appId = Deno.env.get("APP_ID") ?? "self-hosted-livesync-cli-tests";
    const peersTimeout = Number(Deno.env.get("PEERS_TIMEOUT") ?? "20");
    const syncTimeout = Number(Deno.env.get("SYNC_TIMEOUT") ?? "240");
    const roomId = `p2p-room-${Date.now()}`;
    const passphrase = `p2p-pass-${Date.now()}`;

    await using workDir = await TempDir.create("livesync-cli-p2p-upload-download");
    const vaultHost = workDir.join("vault-host");
    const vaultUp = workDir.join("vault-up");
    const vaultDown = workDir.join("vault-down");
    const settingsHost = workDir.join("settings-host.json");
    const settingsUp = workDir.join("settings-up.json");
    const settingsDown = workDir.join("settings-down.json");
    for (const dir of [vaultHost, vaultUp, vaultDown]) {
        await Deno.mkdir(dir, { recursive: true });
    }

    const relayStarted = await maybeStartLocalRelay(relay);
    try {
        for (const settings of [settingsHost, settingsUp, settingsDown]) {
            await initSettingsFile(settings);
            await applyP2pSettings(settings, roomId, passphrase, appId, relay, "~.*");
        }
        await applyP2pTestTweaks(settingsHost, "p2p-cli-host", passphrase);
        await applyP2pTestTweaks(settingsUp, `p2p-cli-upload-${Date.now()}`, passphrase);
        await applyP2pTestTweaks(settingsDown, `p2p-cli-download-${Date.now()}`, passphrase);

        const host = startCliInBackground(vaultHost, "--settings", settingsHost, "p2p-host");
        try {
            await host.waitUntilContains("P2P host is running", 20000);
            const uploadPeer = await discoverPeer(vaultUp, settingsUp, peersTimeout);

            const storeText = workDir.join("store-file.md");
            const diffA = workDir.join("test-diff-1.md");
            const diffB = workDir.join("test-diff-2.md");
            const diffC = workDir.join("test-diff-3.md");
            await Deno.writeTextFile(storeText, "Hello, World!\n");
            await Deno.writeTextFile(diffA, "Content A\n");
            await Deno.writeTextFile(diffB, "Content B\n");
            await Deno.writeTextFile(diffC, "Content C\n");
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", storeText, "p2p/store-file.md");
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", diffA, "p2p/test-diff-1.md");
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", diffB, "p2p/test-diff-2.md");
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", diffC, "p2p/test-diff-3.md");

            const large100k = workDir.join("large-100k.txt");
            const large1m = workDir.join("large-1m.txt");
            const binary100k = workDir.join("binary-100k.bin");
            const binary5m = workDir.join("binary-5m.bin");
            await Deno.writeTextFile(large100k, "a".repeat(100000));
            await Deno.writeTextFile(large1m, "b".repeat(1000000));
            await writeFilledFile(binary100k, 100000, 0x5a);
            await writeFilledFile(binary5m, 5000000, 0x7c);
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", large100k, "p2p/large-100000.md");
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", large1m, "p2p/large-1000000.md");
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", binary100k, "p2p/binary-100000.bin");
            await runCliOrFail(vaultUp, "--settings", settingsUp, "push", binary5m, "p2p/binary-5000000.bin");

            await runCliOrFail(vaultUp, "--settings", settingsUp, "p2p-sync", uploadPeer.id, String(syncTimeout));
            await runCliOrFail(vaultUp, "--settings", settingsUp, "p2p-sync", uploadPeer.id, String(syncTimeout));

            const downloadPeer = await discoverPeer(vaultDown, settingsDown, peersTimeout);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "p2p-sync", downloadPeer.id, String(syncTimeout));
            await runCliOrFail(vaultDown, "--settings", settingsDown, "p2p-sync", downloadPeer.id, String(syncTimeout));

            const downStoreText = workDir.join("down-store-file.md");
            const downDiffA = workDir.join("down-test-diff-1.md");
            const downDiffB = workDir.join("down-test-diff-2.md");
            const downDiffC = workDir.join("down-test-diff-3.md");
            const downLarge100k = workDir.join("down-large-100k.txt");
            const downLarge1m = workDir.join("down-large-1m.txt");
            const downBinary100k = workDir.join("down-binary-100k.bin");
            const downBinary5m = workDir.join("down-binary-5m.bin");
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/store-file.md", downStoreText);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/test-diff-1.md", downDiffA);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/test-diff-2.md", downDiffB);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/test-diff-3.md", downDiffC);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/large-100000.md", downLarge100k);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/large-1000000.md", downLarge1m);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/binary-100000.bin", downBinary100k);
            await runCliOrFail(vaultDown, "--settings", settingsDown, "pull", "p2p/binary-5000000.bin", downBinary5m);

            await assertFilesEqual(storeText, downStoreText, "store-file mismatch");
            await assertFilesEqual(diffA, downDiffA, "test-diff-1 mismatch");
            await assertFilesEqual(diffB, downDiffB, "test-diff-2 mismatch");
            await assertFilesEqual(diffC, downDiffC, "test-diff-3 mismatch");
            await assertFilesEqual(large100k, downLarge100k, "large-100000 mismatch");
            await assertFilesEqual(large1m, downLarge1m, "large-1000000 mismatch");
            await assertFilesEqual(binary100k, downBinary100k, "binary-100000 mismatch");
            await assertFilesEqual(binary5m, downBinary5m, "binary-5000000 mismatch");
        } finally {
            await host.stop();
        }
    } finally {
        await stopLocalRelayIfStarted(relayStarted);
    }
});
