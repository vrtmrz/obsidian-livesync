import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const makeSureOpened = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue(undefined);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const removeStatusListener = vi.fn();
    const onEvent = vi.fn(() => removeStatusListener);
    const WebPeerRuntime = vi.fn(function () {
        return {
            events: { onEvent },
            p2p: {
                transportLifecycle: { connect },
            },
            currentReplicator: { makeSureOpened },
            start,
            shutdown,
        };
    });

    return {
        WebPeerRuntime,
        connect,
        makeSureOpened,
        onEvent,
        removeStatusListener,
        shutdown,
        start,
    };
});

vi.mock("@/apps/webpeer/src/WebPeerRuntime", () => ({
    WebPeerRuntime: runtimeMocks.WebPeerRuntime,
}));

import { P2PCheckSession } from "@/apps/webpeer/src/P2PCheckSession";

describe("P2P connection-check session", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("opens an explicit check through the P2P transport lifecycle", async () => {
        const session = new P2PCheckSession();

        await session.start({} as ObsidianLiveSyncSettings, "browser-check", vi.fn());

        expect(runtimeMocks.start).toHaveBeenCalledOnce();
        expect(runtimeMocks.connect).toHaveBeenCalledOnce();
        expect(runtimeMocks.makeSureOpened).not.toHaveBeenCalled();

        await session.stop();
        expect(runtimeMocks.shutdown).toHaveBeenCalledOnce();
    });
});
