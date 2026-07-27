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

async function waitForSocketOpen(socket, description) {
    if (socket.readyState === WebSocket.OPEN) {
        // Node can expose OPEN before it dispatches the event. Yield once so
        // Trystero's previously registered onopen handler has completed before
        // this probe starts the close handshake.
        await delay(0);
        if (socket.readyState === WebSocket.OPEN) return;
    }

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for ${description}; readyState=${socket.readyState}`));
        }, timeoutMs);
        const cleanup = () => {
            clearTimeout(timeout);
            socket.removeEventListener("open", onOpen);
            socket.removeEventListener("close", onClose);
            socket.removeEventListener("error", onError);
        };
        const onOpen = () => {
            cleanup();
            resolve();
        };
        const onClose = () => {
            cleanup();
            reject(new Error(`${description} closed before opening`));
        };
        const onError = () => {
            cleanup();
            reject(new Error(`${description} failed before opening`));
        };

        // Trystero installs its onopen handler while constructing the socket,
        // before this observer is registered. Waiting for the actual event
        // therefore establishes transport readiness without a fixed delay.
        socket.addEventListener("open", onOpen, { once: true });
        socket.addEventListener("close", onClose, { once: true });
        socket.addEventListener("error", onError, { once: true });
    });
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
    await waitFor("the relay WebSocket to be registered", () => Object.values(getRelaySockets()).length > 0);
    const originalSockets = Object.values(getRelaySockets());
    await Promise.all(
        originalSockets.map((socket, index) => waitForSocketOpen(socket, `relay WebSocket ${index + 1} to open`))
    );

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
    await waitFor("a replacement relay WebSocket to be registered", () =>
        Object.values(getRelaySockets()).some((socket) => !originalSockets.includes(socket))
    );
    const replacementSockets = Object.values(getRelaySockets()).filter((socket) => !originalSockets.includes(socket));
    await Promise.all(
        replacementSockets.map((socket, index) =>
            waitForSocketOpen(socket, `replacement relay WebSocket ${index + 1} to open`)
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
