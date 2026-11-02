import { test } from "node:test";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runProcess } from "./helpers/process.ts";
import assert from "node:assert/strict";

test("p2p lifecycle: explicit disconnect closes and pauses relay WebSockets", async () => {
    const result = await runProcess(process.execPath, {
        args: [fileURLToPath(new URL("./relay-disconnect-probe.mjs", import.meta.url))],
        env: {
            RELAY: process.env["RELAY"] ?? "ws://nostr-relay:7777/",
            RELAY_TIMEOUT_MS: process.env["LIVESYNC_P2P_RELAY_READY_TIMEOUT_MS"] ?? "15000",
        },
        stdout: "piped",
        stderr: "piped",
    });
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();

    assert(result.success, `Relay disconnect probe failed\nstdout: ${stdout}\nstderr: ${stderr}`);
    const report = JSON.parse(stdout.split("\n").at(-1) ?? "{}") as {
        socketsClosed?: number;
        stayedDisconnectedWhilePaused?: boolean;
        reconnectedAfterResume?: boolean;
    };
    assert((report.socketsClosed ?? 0) > 0, "The probe did not observe an open relay WebSocket");
    assert.deepStrictEqual(report.stayedDisconnectedWhilePaused, true);
    assert.deepStrictEqual(report.reconnectedAfterResume, true);
});
