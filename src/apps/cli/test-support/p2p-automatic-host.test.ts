import { createInterface } from "node:readline";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { CLICommandContext, CLIOptions } from "@/apps/cli/commands/types";
import { runCommand } from "@/apps/cli/commands/runCommand";

const FRAME_PREFIX = "@@LIVESYNC_P2P_AUTOMATIC@@";
const SEED_PATH_ENV = "LIVESYNC_CLI_P2P_AUTOMATIC_SEED_PATH";
const SEED_CONTENT_ENV = "LIVESYNC_CLI_P2P_AUTOMATIC_SEED_CONTENT";

type FixtureRequest = {
    id: string;
    action: "state" | "wait-peer" | "write" | "wait-content" | "stop";
    peerName?: string;
    path?: string;
    content?: string;
    timeoutMs?: number;
};

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(value: unknown): string {
    return value instanceof Error ? (value.stack ?? value.message) : String(value);
}

function emitFrame(payload: Record<string, unknown>): void {
    process.stdout.write(`${FRAME_PREFIX}${JSON.stringify(payload)}\n`);
}

function requirePath(path: string | undefined): FilePathWithPrefix {
    if (!path?.trim() || path.includes("\0")) {
        throw new Error("The P2P automatic-host fixture requires a non-empty database path");
    }
    return path as FilePathWithPrefix;
}

async function storeText(
    context: CLICommandContext,
    path: string | undefined,
    content: string | undefined
): Promise<void> {
    if (content === undefined) {
        throw new Error("The P2P automatic-host fixture write request requires content");
    }
    const stored = await context.core.serviceModules.databaseFileAccess.storeContent(requirePath(path), content);
    if (!stored) {
        throw new Error(`Could not store '${path}' in the fixture-owned database`);
    }
}

async function readText(context: CLICommandContext, path: string | undefined): Promise<string | undefined> {
    const source = await context.core.serviceModules.databaseFileAccess.fetch(requirePath(path), undefined, true);
    if (!source || source.deleted) return undefined;
    if (source.body.type === "text/plain") return await source.body.text();
    return new TextDecoder().decode(await source.body.arrayBuffer());
}

function getPolicy(context: CLICommandContext) {
    const settings = context.core.services.setting.currentSettings();
    return {
        P2P_Enabled: settings.P2P_Enabled,
        P2P_AutoAccepting: settings.P2P_AutoAccepting,
        P2P_AutoStart: settings.P2P_AutoStart,
        P2P_AutoBroadcast: settings.P2P_AutoBroadcast,
        P2P_AutoSyncPeers: settings.P2P_AutoSyncPeers,
        P2P_AutoWatchPeers: settings.P2P_AutoWatchPeers,
    };
}

/** Runs a persistent real P2P service with in-process controls for the E2E test. */
export async function runP2PAutomaticHostFixture(options: CLIOptions, context: CLICommandContext): Promise<boolean> {
    const seedPath = process.env[SEED_PATH_ENV];
    const seedContent = process.env[SEED_CONTENT_ENV];
    if (seedPath !== undefined || seedContent !== undefined) {
        await storeText(context, seedPath, seedContent);
    }

    const service = context.p2pReplicator;
    if (!service) {
        throw new Error("The CLI did not expose its P2P service-feature result to the automatic-host fixture");
    }
    const commandOutcome = runCommand(options, context).then(
        (result) => ({ type: "result" as const, result }),
        (error) => ({ type: "error" as const, error })
    );
    const connectedWaitStarted = Date.now();
    while (!service.transportLifecycle.isConnected) {
        const earlyOutcome = await Promise.race([commandOutcome, delay(200).then(() => undefined)]);
        if (earlyOutcome) {
            if (earlyOutcome.type === "error") throw earlyOutcome.error;
            return earlyOutcome.result;
        }
        if (Date.now() - connectedWaitStarted > 30000) {
            throw new Error("The production p2p-host command did not connect within 30000ms");
        }
    }
    const input = createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });
    emitFrame({
        type: "ready",
        connected: service.transportLifecycle.isConnected,
        policy: getPolicy(context),
    });

    const controls = (async () => {
        try {
            for await (const line of input) {
                let request: FixtureRequest | undefined;
                try {
                    request = JSON.parse(line) as FixtureRequest;
                    if (typeof request.id !== "string" || !request.id) {
                        throw new Error("The P2P automatic-host fixture request requires an id");
                    }

                    let result: unknown;
                    if (request.action === "state") {
                        result = {
                            connected: service.transportLifecycle.isConnected,
                            peers: service.peerDirectory.getPeers().map((peer) => ({
                                name: peer.name,
                                peerId: peer.peerId,
                            })),
                            policy: getPolicy(context),
                        };
                    } else if (request.action === "wait-peer") {
                        const peerName = request.peerName?.trim();
                        if (!peerName) {
                            throw new Error("The wait-peer request requires peerName");
                        }
                        const timeoutMs = request.timeoutMs ?? 20000;
                        const started = Date.now();
                        let peer = service.peerDirectory.getPeers().find((candidate) => candidate.name === peerName);
                        while (!peer && Date.now() - started < timeoutMs) {
                            await delay(200);
                            peer = service.peerDirectory.getPeers().find((candidate) => candidate.name === peerName);
                        }
                        if (!peer) {
                            const known = service.peerDirectory
                                .getPeers()
                                .map((candidate) => `${candidate.name} (${candidate.peerId})`)
                                .join(", ");
                            throw new Error(
                                `Peer '${peerName}' was not discovered within ${timeoutMs}ms. Known peers: ${
                                    known || "none"
                                }`
                            );
                        }
                        result = { name: peer.name, peerId: peer.peerId };
                    } else if (request.action === "write") {
                        await storeText(context, request.path, request.content);
                        result = { path: request.path };
                    } else if (request.action === "wait-content") {
                        const path = requirePath(request.path);
                        if (request.content === undefined) {
                            throw new Error("The wait-content request requires content");
                        }
                        const timeoutMs = request.timeoutMs ?? 30000;
                        const started = Date.now();
                        let actual = await readText(context, path);
                        while (actual !== request.content && Date.now() - started < timeoutMs) {
                            await delay(200);
                            actual = await readText(context, path);
                        }
                        if (actual !== request.content) {
                            throw new Error(
                                `Timed out waiting for '${path}' to contain the expected text within ${timeoutMs}ms; ` +
                                    `last content: ${actual === undefined ? "missing" : JSON.stringify(actual)}`
                            );
                        }
                        emitFrame({
                            type: "checkpoint",
                            id: request.id,
                            action: request.action,
                            path,
                            content: actual,
                        });
                        result = { path, content: actual };
                    } else if (request.action === "stop") {
                        emitFrame({
                            type: "response",
                            id: request.id,
                            ok: true,
                            result: { stopping: true },
                        });
                        break;
                    } else {
                        throw new Error(`Unknown P2P automatic-host fixture action: ${String(request.action)}`);
                    }

                    emitFrame({
                        type: "response",
                        id: request.id,
                        ok: true,
                        result,
                    });
                } catch (error) {
                    emitFrame({
                        type: "response",
                        id: request?.id ?? "",
                        ok: false,
                        error: describeError(error),
                    });
                }
            }
        } finally {
            input.close();
        }
    })();

    const outcome = await Promise.race([
        commandOutcome.then((result) => ({ type: "command" as const, result })),
        controls.then(() => ({ type: "controls" as const })),
    ]);
    input.close();
    if (outcome.type === "controls") return true;
    if (outcome.result.type === "error") throw outcome.result.error;
    return outcome.result.result;
}
