import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { TempDir } from "./helpers/temp.ts";
import { applyP2pSettings, applyP2pTestTweaks, initSettingsFile } from "./helpers/settings.ts";
import { CLI_DIR } from "./helpers/cli.ts";
import { maybeStartCoturn, maybeStartLocalRelay, stopCoturnIfStarted, stopLocalRelayIfStarted } from "./helpers/p2p.ts";

const FRAME_PREFIX = "@@LIVESYNC_P2P_AUTOMATIC@@";
const SEED_PATH_ENV = "LIVESYNC_CLI_P2P_AUTOMATIC_SEED_PATH";
const SEED_CONTENT_ENV = "LIVESYNC_CLI_P2P_AUTOMATIC_SEED_CONTENT";
const HOST_BASELINE = {
    path: "p2p/automatic-host-baseline.md",
    content: "Saved by the persistent P2P host.",
};
const CLIENT_A_BASELINE = {
    path: "p2p/automatic-client-a-baseline.md",
    content: "Saved by client A before joining.",
};
const CLIENT_A_UPDATE = {
    path: "p2p/automatic-client-a-update.md",
    content: "Sent through the host auto-watch.",
};
const HOST_UPDATE = {
    path: "p2p/automatic-host-update.md",
    content: "Broadcast by the host to its watcher.",
};
const CLIENT_B_UPDATE = {
    path: "p2p/automatic-client-b-update.md",
    content: "Sent through the restarted host's watcher.",
};
const CLIENT_B_DURING_OUTAGE = {
    path: "p2p/automatic-client-b-during-outage.md",
    content: "Retained by client B while the host restarts.",
};

type FixtureState = {
    connected: boolean;
    peers: { name: string; peerId: string }[];
    policy: Record<string, unknown>;
};

type FixtureResponse = {
    type: "response";
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
};

type FixtureReady = {
    type: "ready";
    connected: boolean;
    policy: Record<string, unknown>;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`Timed out ${description} after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
    });
}

class AutomaticP2PHostProcess {
    #stdout = "";
    #stdoutLineBuffer = "";
    #stderr = "";
    #nextId = 0;
    #pending = new Map<
        string,
        {
            resolve: (value: FixtureResponse) => void;
            reject: (reason: Error) => void;
        }
    >();
    #resolveReady!: (value: FixtureReady) => void;
    #rejectReady!: (reason: Error) => void;
    #ready = new Promise<FixtureReady>((resolve, reject) => {
        this.#resolveReady = resolve;
        this.#rejectReady = reject;
    });
    #stdinWriter: WritableStreamDefaultWriter<Uint8Array>;
    #stdoutTask: Promise<void>;
    #stderrTask: Promise<void>;
    #status: Promise<Deno.CommandStatus>;
    #stopped = false;

    private constructor(readonly child: Deno.ChildProcess) {
        this.#stdinWriter = child.stdin.getWriter();
        this.#stdoutTask = this.#pump(child.stdout, (text) => this.#handleStdout(text));
        this.#stderrTask = this.#pump(child.stderr, (text) => (this.#stderr += text));
        this.#status = child.status.then((status) => {
            if (!this.#stopped) {
                const error = new Error(
                    `P2P automatic-host fixture exited with code ${status.code}\n${this.diagnostics}`
                );
                this.#rejectReady(error);
                for (const pending of this.#pending.values()) {
                    pending.reject(error);
                }
                this.#pending.clear();
            }
            return status;
        });
    }

    static async start(
        vaultPath: string,
        settingsPath: string,
        seed: { path: string; content: string } | undefined,
        readyTimeoutMs: number
    ): Promise<AutomaticP2PHostProcess> {
        const env: Record<string, string> = {};
        if (seed) {
            env[SEED_PATH_ENV] = seed.path;
            env[SEED_CONTENT_ENV] = seed.content;
        }
        const child = new Deno.Command("node", {
            args: [join(CLI_DIR, "dist", "p2p-lifecycle-test.cjs"), vaultPath, "--settings", settingsPath, "p2p-host"],
            cwd: CLI_DIR,
            env,
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        const fixture = new AutomaticP2PHostProcess(child);
        try {
            await withTimeout(fixture.#ready, readyTimeoutMs, "waiting for the P2P automatic-host fixture to connect");
            return fixture;
        } catch (error) {
            await fixture.#kill().catch(() => {});
            throw new Error(`${String(error)}\n${fixture.diagnostics}`);
        }
    }

    get diagnostics(): string {
        return `stdout:\n${this.#stdout.slice(-8000)}\nstderr:\n${this.#stderr.slice(-8000)}`;
    }

    async #pump(stream: ReadableStream<Uint8Array>, consume: (text: string) => void): Promise<void> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) consume(decoder.decode(value, { stream: true }));
            }
            consume(decoder.decode());
        } finally {
            reader.releaseLock();
        }
    }

    #handleStdout(text: string): void {
        this.#stdout += text;
        const lines = (this.#stdoutLineBuffer + text).split(/\r?\n/);
        this.#stdoutLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith(FRAME_PREFIX)) continue;
            try {
                const frame = JSON.parse(line.slice(FRAME_PREFIX.length)) as FixtureReady | FixtureResponse;
                if (frame.type === "ready") {
                    this.#resolveReady(frame);
                } else if (frame.type === "response") {
                    const pending = this.#pending.get(frame.id);
                    if (!pending) continue;
                    this.#pending.delete(frame.id);
                    pending.resolve(frame);
                }
            } catch (error) {
                this.#rejectReady(new Error(`Could not parse a P2P automatic-host fixture response: ${String(error)}`));
            }
        }
    }

    async ready(): Promise<FixtureReady> {
        return await this.#ready;
    }

    async request<T>(action: string, fields: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
        await this.#ready;
        const id = String(++this.#nextId);
        const responsePromise = new Promise<FixtureResponse>((resolve, reject) => {
            this.#pending.set(id, { resolve, reject });
        });
        try {
            await this.#stdinWriter.write(new TextEncoder().encode(`${JSON.stringify({ id, action, ...fields })}\n`));
            const response = await withTimeout(responsePromise, timeoutMs, `waiting for fixture action '${action}'`);
            if (!response.ok) {
                throw new Error(response.error ?? `Fixture action '${action}' failed`);
            }
            return response.result as T;
        } catch (error) {
            this.#pending.delete(id);
            throw new Error(`${String(error)}\n${this.diagnostics}`);
        }
    }

    async state(): Promise<FixtureState> {
        return await this.request<FixtureState>("state");
    }

    async waitForPeer(peerName: string, timeoutMs: number): Promise<void> {
        await this.request("wait-peer", { peerName, timeoutMs }, timeoutMs + 3000);
    }

    async write(path: string, content: string): Promise<void> {
        await this.request("write", { path, content });
    }

    async waitForContent(note: { path: string; content: string }, timeoutMs: number): Promise<void> {
        await this.request(
            "wait-content",
            {
                path: note.path,
                content: note.content,
                timeoutMs,
            },
            timeoutMs + 3000
        );
    }

    async stop(): Promise<number> {
        if (this.#stopped) return (await this.#status).code;
        try {
            await this.request("stop", {}, 5000);
            this.#stopped = true;
            const status = await withTimeout(this.#status, 12000, "waiting for the P2P fixture to stop gracefully");
            await Promise.all([this.#stdoutTask, this.#stderrTask]);
            return status.code;
        } catch (error) {
            await this.#kill().catch(() => {});
            throw new Error(`${String(error)}\n${this.diagnostics}`);
        }
    }

    async #kill(): Promise<void> {
        this.#stopped = true;
        try {
            this.child.kill("SIGTERM");
        } catch {
            // The process may already have exited.
        }
        try {
            await withTimeout(this.#status, 3000, "waiting for the P2P fixture to exit");
        } catch {
            try {
                this.child.kill("SIGKILL");
            } catch {
                // The process may already have exited.
            }
            await this.#status;
        }
        await Promise.all([this.#stdoutTask, this.#stderrTask]);
    }
}

async function configureAutomaticSettings(
    settingsPath: string,
    peerName: string,
    roomId: string,
    passphrase: string,
    relay: string,
    turnServers: string,
    autoAcceptingPeers: string,
    autoSyncPeers: string,
    autoWatchPeers: string
): Promise<void> {
    await initSettingsFile(settingsPath);
    await applyP2pSettings(
        settingsPath,
        roomId,
        passphrase,
        "self-hosted-livesync-cli-automatic-host-tests",
        relay,
        "~.*",
        turnServers
    );
    await applyP2pTestTweaks(settingsPath, peerName, passphrase);
    const settings = JSON.parse(await Deno.readTextFile(settingsPath));
    settings.P2P_AutoAccepting = 0;
    settings.P2P_AutoStart = false;
    settings.P2P_AutoBroadcast = true;
    settings.P2P_AutoSyncPeers = autoSyncPeers;
    settings.P2P_AutoWatchPeers = autoWatchPeers;
    settings.P2P_AutoAcceptingPeers = autoAcceptingPeers;
    settings.P2P_AutoDenyingPeers = "";
    await Deno.writeTextFile(settingsPath, JSON.stringify(settings, null, 2));
}

Deno.test("p2p-host: restored automatic policy syncs clients through a persistent middle peer", async () => {
    const relay = Deno.env.get("RELAY") ?? "ws://localhost:4000/";
    const peersTimeoutMs = Number(Deno.env.get("PEERS_TIMEOUT") ?? "20") * 1000;
    const syncTimeoutMs = Number(Deno.env.get("SYNC_TIMEOUT") ?? "60") * 1000;
    const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const roomId = `automatic-host-room-${nonce}`;
    const passphrase = `automatic-host-pass-${nonce}`;
    const hostPeerName = `p2p-auto-host-${nonce}`;
    const clientAPeerName = `p2p-auto-client-a-${nonce}`;
    const clientBPeerName = `p2p-auto-client-b-${nonce}`;
    const useCoturn = Deno.env.get("LIVESYNC_USE_COTURN") !== "0";
    const turnServers = Deno.env.get("TURN_SERVERS") ?? (useCoturn ? "turn:127.0.0.1:3478" : "none");

    await using workDir = await TempDir.create("livesync-cli-p2p-automatic-host");
    const hostVault = workDir.join("vault-host");
    const clientAVault = workDir.join("vault-client-a");
    const clientBVault = workDir.join("vault-client-b");
    const hostSettings = workDir.join("settings-host.json");
    const clientASettings = workDir.join("settings-client-a.json");
    const clientBSettings = workDir.join("settings-client-b.json");
    await Promise.all([
        Deno.mkdir(hostVault, { recursive: true }),
        Deno.mkdir(clientAVault, { recursive: true }),
        Deno.mkdir(clientBVault, { recursive: true }),
    ]);

    const relayStarted = await maybeStartLocalRelay(relay);
    const coturnStarted = await maybeStartCoturn(turnServers);
    let host: AutomaticP2PHostProcess | undefined;
    let clientA: AutomaticP2PHostProcess | undefined;
    let clientB: AutomaticP2PHostProcess | undefined;
    try {
        const hostPeerPattern = "~p2p-auto-client-.*";
        await configureAutomaticSettings(
            hostSettings,
            hostPeerName,
            roomId,
            passphrase,
            relay,
            turnServers,
            hostPeerPattern,
            hostPeerPattern,
            hostPeerPattern
        );
        for (const [settingsPath, peerName] of [
            [clientASettings, clientAPeerName],
            [clientBSettings, clientBPeerName],
        ]) {
            await configureAutomaticSettings(
                settingsPath,
                peerName,
                roomId,
                passphrase,
                relay,
                turnServers,
                hostPeerName,
                hostPeerName,
                hostPeerName
            );
        }

        host = await AutomaticP2PHostProcess.start(hostVault, hostSettings, HOST_BASELINE, 20000);
        const initialHostState = await host.state();
        assert(initialHostState.connected, "p2p-host did not explicitly connect while P2P_AutoStart was false");
        assertEquals(
            initialHostState.policy,
            {
                P2P_Enabled: true,
                P2P_AutoAccepting: 0,
                P2P_AutoStart: false,
                P2P_AutoBroadcast: true,
                P2P_AutoSyncPeers: hostPeerPattern,
                P2P_AutoWatchPeers: hostPeerPattern,
            },
            "The host did not restore its original P2P policy before serving peers"
        );

        clientA = await AutomaticP2PHostProcess.start(clientAVault, clientASettings, CLIENT_A_BASELINE, 20000);
        await host.waitForPeer(clientAPeerName, peersTimeoutMs);
        await clientA.waitForPeer(hostPeerName, peersTimeoutMs);

        await host.waitForContent(CLIENT_A_BASELINE, syncTimeoutMs);
        await clientA.waitForContent(HOST_BASELINE, syncTimeoutMs);

        await clientA.write(CLIENT_A_UPDATE.path, CLIENT_A_UPDATE.content);
        await host.waitForContent(CLIENT_A_UPDATE, syncTimeoutMs);
        await host.write(HOST_UPDATE.path, HOST_UPDATE.content);
        await clientA.waitForContent(HOST_UPDATE, syncTimeoutMs);

        assertEquals(await clientA.stop(), 0, "Client A did not stop cleanly before going offline");
        clientA = undefined;

        clientB = await AutomaticP2PHostProcess.start(clientBVault, clientBSettings, undefined, 20000);
        await host.waitForPeer(clientBPeerName, peersTimeoutMs);
        await clientB.waitForPeer(hostPeerName, peersTimeoutMs);
        await clientB.waitForContent(CLIENT_A_BASELINE, syncTimeoutMs);
        await clientB.waitForContent(CLIENT_A_UPDATE, syncTimeoutMs);
        await clientB.waitForContent(HOST_BASELINE, syncTimeoutMs);
        await clientB.waitForContent(HOST_UPDATE, syncTimeoutMs);

        await clientB.write(CLIENT_B_UPDATE.path, CLIENT_B_UPDATE.content);
        await host.waitForContent(CLIENT_B_UPDATE, syncTimeoutMs);

        assertEquals(await host.stop(), 0, "The persistent host did not stop cleanly for its restart check");
        host = undefined;
        await clientB.write(CLIENT_B_DURING_OUTAGE.path, CLIENT_B_DURING_OUTAGE.content);

        host = await AutomaticP2PHostProcess.start(hostVault, hostSettings, undefined, 20000);
        const restartedHostState = await host.state();
        assert(restartedHostState.connected, "The restarted p2p-host did not connect");
        assertEquals(
            restartedHostState.policy,
            initialHostState.policy,
            "The restarted host did not restore its original P2P policy"
        );
        await host.waitForPeer(clientBPeerName, peersTimeoutMs);
        await clientB.waitForPeer(hostPeerName, peersTimeoutMs);
        await host.waitForContent(CLIENT_B_UPDATE, syncTimeoutMs);
        await host.waitForContent(CLIENT_B_DURING_OUTAGE, syncTimeoutMs);
        await clientB.waitForContent(HOST_BASELINE, syncTimeoutMs);
        await clientB.waitForContent(HOST_UPDATE, syncTimeoutMs);
    } finally {
        await Promise.allSettled([host?.stop(), clientA?.stop(), clientB?.stop()].filter(Boolean) as Promise<number>[]);
        await stopLocalRelayIfStarted(relayStarted);
        await stopCoturnIfStarted(coturnStarted);
    }
});
