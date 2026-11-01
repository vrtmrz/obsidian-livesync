import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

for (const [pathNormalizationVersion, encrypted] of [
    [0, true],
    [1, true],
    [1, false],
] as const) {
    test(`p2p-sync: identity mode ${pathNormalizationVersion}, encryption ${encrypted} transfers matching IDs and rejects incompatible peers`, async () => {
        const loopbackIp = await getOptimalLoopbackIp();
        const loopbackHost = loopbackIp === "::1" ? "[::1]" : loopbackIp;

        const relay = process.env["RELAY"] ?? `ws://${loopbackHost}:4000/`;
        const roomId = process.env["ROOM_ID"] ?? `room-${Date.now()}`;
        const passphrase = process.env["PASSPHRASE"] ?? "test";
        const peersTimeout = Number(process.env["PEERS_TIMEOUT"] ?? "12");
        const syncTimeout = Number(process.env["SYNC_TIMEOUT"] ?? "15");
        const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const hostPeerName = process.env["HOST_PEER_NAME"] ?? `p2p-host-${nonce}`;
        const clientPeerName = process.env["CLIENT_PEER_NAME"] ?? `p2p-client-${nonce}`;
        const useCoturn = process.env["LIVESYNC_USE_COTURN"] !== "0";
        const turnServers = process.env["TURN_SERVERS"] ?? (useCoturn ? `turn:${loopbackHost}:3478` : "none");

        await using workDir = await TempDir.create("livesync-cli-p2p-sync");
        const hostVault = workDir.join("vault-host");
        const hostSettings = workDir.join("settings-host.json");
        const clientVault = workDir.join("vault-sync");
        const clientSettings = workDir.join("settings-sync.json");
        const rejectedVault = workDir.join("vault-rejected");
        const rejectedSettings = workDir.join("settings-rejected.json");
        await mkdir(hostVault, { recursive: true });
        await mkdir(clientVault, { recursive: true });
        await mkdir(rejectedVault, { recursive: true });

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
                [
                    rejectedVault,
                    rejectedSettings,
                    (pathNormalizationVersion === 1 ? "ab" : "cd").repeat(32),
                    "rejected",
                ],
            ]) {
                const settings = JSON.parse(await readFile(path, "utf8"));
                settings.pathNormalizationVersion =
                    pathNormalizationVersion === 1 && label === "rejected" ? 0 : pathNormalizationVersion;
                settings.encrypt = encrypted;
                settings.usePathObfuscation = encrypted;
                settings.idDerivationVersion = 1;
                settings.idDerivationKey = key;
                const sourcePath = workDir.join("setup-source-" + label + ".json");
                await writeFile(sourcePath, JSON.stringify(settings));
                const setupPassphrase = "independent-id-setup-passphrase";
                const setupUri = await generateSetupUriFromSettings(sourcePath, setupPassphrase, true);
                await runCliWithInputOrFail(setupPassphrase + "\n", vault, "--settings", path, "setup", setupUri);
                const persisted = JSON.parse(await readFile(path, "utf8"));
                assert(persisted.idDerivationVersion === 1, "The Setup URI lost the ID derivation version.");
                assert(
                    persisted.pathNormalizationVersion === settings.pathNormalizationVersion,
                    "The Setup URI lost the path identity version."
                );
                assert(persisted.idDerivationKey === "", "The CLI stored the ID key in plain text.");
                assert(
                    typeof persisted.encryptedIdDerivationKey === "string" &&
                        persisted.encryptedIdDerivationKey.length > 0,
                    "The CLI did not encrypt the saved ID key."
                );
                assert(persisted.P2P_Enabled === true, "The Setup URI disabled P2P.");
                assert(persisted.P2P_roomID === roomId, "The Setup URI changed the P2P room.");
                assert(persisted.P2P_relays === relay, "The Setup URI changed the P2P relay.");
                assert(persisted.remoteType === "ONLY_P2P", "The Setup URI changed the remote type.");
            }
            const notePath =
                pathNormalizationVersion === 1 ? "Cafe\u0301/re\u0301sume\u0301.md" : "p2p/independent-id-note.md";
            const receivedPath = notePath.normalize("NFC");
            await runCliWithInputOrFail(
                "A note transferred with the saved ID key.\n",
                clientVault,
                "--settings",
                clientSettings,
                "put",
                notePath
            );

            const originalInfo = JSON.parse(
                await runCliOrFail(clientVault, "--settings", clientSettings, "info", notePath)
            ) as { id: string; revision: string };
            if (pathNormalizationVersion === 1) {
                assert.equal(
                    sanitiseCatStdout(
                        await runCliOrFail(clientVault, "--settings", clientSettings, "cat", receivedPath)
                    ),
                    "A note transferred with the saved ID key.\n",
                    "The NFC spelling did not address the NFD Metadata."
                );
            }
            const host = startCliInBackground(hostVault, "--settings", hostSettings, "p2p-host");
            try {
                await host.waitUntilContains("P2P host is running", 20000);
                const peer = await discoverPeer(
                    clientVault,
                    clientSettings,
                    peersTimeout,
                    process.env["TARGET_PEER"] ?? hostPeerName
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
                    `P2P accepted incompatible peer settings.\nstdout: ${rejectedSync.stdout}\nstderr: ${rejectedSync.stderr}`
                );

                assert(
                    rejectedSync.combined.includes("Tweak values are not matched"),
                    `P2P failed before checking peer settings.\nstdout: ${rejectedSync.stdout}\nstderr: ${rejectedSync.stderr}`
                );
            } finally {
                await host.stop();
            }
            const received = sanitiseCatStdout(
                await runCliOrFail(hostVault, "--settings", hostSettings, "cat", receivedPath)
            ).trimEnd();
            assert(
                received === "A note transferred with the saved ID key.",
                "The host did not receive the keyed note."
            );
            const rejectedRead = await runCli(rejectedVault, "--settings", rejectedSettings, "cat", notePath);
            assert(rejectedRead.code !== 0, "The rejected device received the keyed note.");
            if (pathNormalizationVersion === 1) {
                const canonicalRead = await runCli(rejectedVault, "--settings", rejectedSettings, "cat", receivedPath);
                assert(
                    canonicalRead.code !== 0,
                    "The rejected device received canonical Metadata despite its different identity mode."
                );
            }
            if (pathNormalizationVersion === 1) {
                const exchange = async (
                    senderVault: string,
                    senderSettings: string,
                    receiverVault: string,
                    receiverSettings: string,
                    receiverName: string
                ) => {
                    const restartedHost = startCliInBackground(
                        receiverVault,
                        "--settings",
                        receiverSettings,
                        "p2p-host"
                    );
                    try {
                        await restartedHost.waitUntilContains("P2P host is running", 20000);
                        const peer = await discoverPeer(senderVault, senderSettings, peersTimeout, receiverName);
                        await runCliOrFail(
                            senderVault,
                            "--settings",
                            senderSettings,
                            "p2p-sync",
                            peer.id,
                            String(syncTimeout)
                        );
                    } finally {
                        await restartedHost.stop();
                    }
                };
                const editedBody = "Edited through the NFC spelling after process restart.\n";
                await runCliWithInputOrFail(editedBody, hostVault, "--settings", hostSettings, "put", receivedPath);
                await exchange(hostVault, hostSettings, clientVault, clientSettings, clientPeerName);
                assert.equal(
                    sanitiseCatStdout(await runCliOrFail(clientVault, "--settings", clientSettings, "cat", notePath)),
                    editedBody
                );
                const storedPath = (await runCliOrFail(clientVault, "--settings", clientSettings, "ls"))
                    .trim()
                    .split("\t")[0];
                assert.equal(storedPath.normalize("NFC"), receivedPath);
                const editedInfo = JSON.parse(
                    await runCliOrFail(clientVault, "--settings", clientSettings, "info", storedPath)
                ) as { id: string };
                assert.equal(editedInfo.id, originalInfo.id, "The reverse edit changed the canonical Metadata ID.");
                assert.equal(
                    sanitiseCatStdout(
                        await runCliOrFail(
                            clientVault,
                            "--settings",
                            clientSettings,
                            "cat-rev",
                            notePath,
                            originalInfo.revision
                        )
                    ),
                    "A note transferred with the saved ID key.\n",
                    "P2P discarded the original revision body."
                );

                const renamedPath = "Cafe\u0301/renamed.md";
                await runCliWithInputOrFail(editedBody, clientVault, "--settings", clientSettings, "put", renamedPath);
                await runCliOrFail(clientVault, "--settings", clientSettings, "rm", receivedPath);
                await exchange(clientVault, clientSettings, hostVault, hostSettings, hostPeerName);
                assert.notEqual((await runCli(hostVault, "--settings", hostSettings, "cat", notePath)).code, 0);
                assert.equal(
                    sanitiseCatStdout(
                        await runCliOrFail(hostVault, "--settings", hostSettings, "cat", renamedPath.normalize("NFC"))
                    ),
                    editedBody
                );
                await runCliOrFail(clientVault, "--settings", clientSettings, "rm", renamedPath.normalize("NFC"));
                await exchange(clientVault, clientSettings, hostVault, hostSettings, hostPeerName);
                assert.notEqual((await runCli(hostVault, "--settings", hostSettings, "cat", renamedPath)).code, 0);
            }
        } finally {
            await stopLocalRelayIfStarted(relayStarted);
            await stopCoturnIfStarted(coturnStarted);
        }
    });
}
