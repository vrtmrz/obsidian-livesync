import { assert, assertEquals } from "@std/assert";

Deno.test("p2p lifecycle: explicit disconnect closes and pauses relay WebSockets", async () => {
    const command = new Deno.Command("node", {
        args: [new URL("./relay-disconnect-probe.mjs", import.meta.url).pathname],
        env: {
            RELAY: Deno.env.get("RELAY") ?? "ws://nostr-relay:7777/",
            RELAY_TIMEOUT_MS: Deno.env.get("LIVESYNC_P2P_RELAY_READY_TIMEOUT_MS") ?? "15000",
        },
        stdout: "piped",
        stderr: "piped",
    });
    const result = await command.output();
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();

    assert(result.success, `Relay disconnect probe failed\nstdout: ${stdout}\nstderr: ${stderr}`);
    const report = JSON.parse(stdout.split("\n").at(-1) ?? "{}") as {
        socketsClosed?: number;
        stayedDisconnectedWhilePaused?: boolean;
        reconnectedAfterResume?: boolean;
    };
    assert((report.socketsClosed ?? 0) > 0, "The probe did not observe an open relay WebSocket");
    assertEquals(report.stayedDisconnectedWhilePaused, true);
    assertEquals(report.reconnectedAfterResume, true);
});
