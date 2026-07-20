import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { RTCPeerConnection } from "werift";
import { TrysteroReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicator";

const requireFromProbe = createRequire(import.meta.url);
const commonlibEntry = requireFromProbe.resolve("@vrtmrz/livesync-commonlib/context");
const requireFromCommonlib = createRequire(commonlibEntry);
const nostrEntry = requireFromCommonlib.resolve("@trystero-p2p/nostr");
const { getRelaySockets, joinRoom, pauseRelayReconnection } = await import(pathToFileURL(nostrEntry).href);

const relayUrl = process.env.RELAY ?? "ws://nostr-relay:7777/";
const timeoutMs = Number(process.env.RELAY_TIMEOUT_MS ?? 15_000);

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(description, predicate) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (predicate()) return;
        await delay(50);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

const room = joinRoom(
    {
        appId: `livesync-relay-disconnect-probe-${Date.now()}`,
        password: "local-test-only",
        relayConfig: {
            urls: [relayUrl],
            manualReconnection: true,
        },
        rtcPolyfill: RTCPeerConnection,
    },
    "disconnect-probe"
);

try {
    await waitFor("the relay WebSocket to open", () =>
        Object.values(getRelaySockets()).some((socket) => socket.readyState === WebSocket.OPEN)
    );
    const originalSockets = Object.values(getRelaySockets());

    const replicator = new TrysteroReplicator(
        {},
        {
            close: async () => undefined,
            dispatchConnectionStatus: async () => undefined,
        }
    );
    replicator.disconnectFromServer();

    await waitFor("all relay WebSockets to close", () =>
        originalSockets.every((socket) => socket.readyState === WebSocket.CLOSED)
    );
    await delay(4_000);
    if (!originalSockets.every((socket) => socket.readyState === WebSocket.CLOSED)) {
        throw new Error("A relay WebSocket reconnected while reconnection was paused");
    }

    replicator.allowReconnection();
    await waitFor("a replacement relay WebSocket to open", () =>
        Object.values(getRelaySockets()).some(
            (socket) => !originalSockets.includes(socket) && socket.readyState === WebSocket.OPEN
        )
    );

    console.log(
        JSON.stringify({
            socketsClosed: originalSockets.length,
            stayedDisconnectedWhilePaused: true,
            reconnectedAfterResume: true,
        })
    );
} finally {
    await room.leave();
    pauseRelayReconnection();
    for (const socket of Object.values(getRelaySockets())) socket.close();
}
