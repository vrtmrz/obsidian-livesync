import { describe, expect, it, vi } from "vitest";
import type { P2PDiagnosticEvent, P2PDiagnostics, P2PDiagnosticSnapshot } from "@vrtmrz/livesync-commonlib/p2p";
import { formatP2PDiagnosticLog, observeP2PDiagnosticRows, projectP2PDiagnosticRows } from "./P2PDiagnosticDisplay.ts";

const peerLeft: P2PDiagnosticEvent = {
    category: "peer",
    code: "peer-left",
    timestamp: 1_700_000_000_000,
    peerId: "fixture-peer-id",
};

function diagnostics(snapshot: P2PDiagnosticSnapshot = {}) {
    let listener: ((event: P2PDiagnosticEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const service: P2PDiagnostics = {
        requestStatus: vi.fn(),
        getPeerConnectionMetrics: vi.fn(),
        getDiagnosticSnapshot: () => snapshot,
        onDiagnosticEvent: (callback) => {
            listener = callback;
            return unsubscribe;
        },
    };
    return { service, unsubscribe, emit: (event: P2PDiagnosticEvent) => listener?.(event) };
}

describe("P2P diagnostic presentation", () => {
    it("shows unobserved categories rather than claiming zero or success", () => {
        const rows = projectP2PDiagnosticRows({});
        expect(rows.map((row) => [row.label, row.text, row.time])).toEqual([
            ["Relay", "Not observed", ""],
            ["Peer", "Not observed", ""],
            ["Sync", "Not observed", ""],
        ]);
        expect(projectP2PDiagnosticRows({}, false).every((row) => row.text === "Unavailable")).toBe(true);
    });

    it("states that room activation does not measure relay acceptance", () => {
        const event: P2PDiagnosticEvent = {
            category: "relay",
            code: "room-opened",
            timestamp: peerLeft.timestamp,
            reason: "relay-details-unobserved",
        };
        expect(projectP2PDiagnosticRows({ relay: event })[0].text).toBe("Room opened; relay replies not observed");
        expect(formatP2PDiagnosticLog(event)).toContain("[P2P Diag] Relay: Room opened; relay replies not observed");
        expect(formatP2PDiagnosticLog(event)).toContain(new Date(event.timestamp).toISOString());
    });

    it("distinguishes explicit refusal, timeout, and unobserved watch policy", () => {
        const refused: P2PDiagnosticEvent = { category: "peer", code: "auth-refused", timestamp: peerLeft.timestamp };
        const timedOut = { ...refused, code: "auth-timeout" } as const;
        expect(formatP2PDiagnosticLog(refused)).toContain("Authentication refused");
        expect(formatP2PDiagnosticLog(timedOut)).toContain("Authentication timed out");
        expect(
            formatP2PDiagnosticLog({
                category: "sync",
                code: "watch-skipped",
                reason: "peer-broadcast-unobserved",
                timestamp: peerLeft.timestamp,
            })
        ).toContain("peer announcement state not observed");
    });

    it("replays a lost peer's latest observation and retains it while other categories change", () => {
        const fixture = diagnostics({ peer: peerLeft });
        const listener = vi.fn();
        const dispose = observeP2PDiagnosticRows(fixture.service, listener);
        expect(listener.mock.lastCall?.[0][1].text).toContain("Peer left");
        fixture.emit({ category: "relay", code: "room-closed", timestamp: peerLeft.timestamp + 100 });
        const latest = listener.mock.lastCall?.[0];
        expect(latest?.[0].text).toBe("Room closed");
        expect(latest?.[1].text).toContain("Peer left");
        expect(latest?.[1].title).toBe(new Date(peerLeft.timestamp).toLocaleString());
        dispose();
        dispose();
        fixture.emit({ ...peerLeft, code: "peer-advertised" });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    });

    it("accepts an older diagnostics view without extending its contract", () => {
        const listener = vi.fn();
        const dispose = observeP2PDiagnosticRows(
            { requestStatus: vi.fn(), getPeerConnectionMetrics: vi.fn() },
            listener
        );
        expect(listener.mock.lastCall?.[0].map((row: { text: string }) => row.text)).toEqual([
            "Unavailable",
            "Unavailable",
            "Unavailable",
        ]);
        dispose();
    });

    it("does not put peer control characters into a log line and tolerates missing timestamps", () => {
        expect(formatP2PDiagnosticLog({ ...peerLeft, peerId: "bad\npeer\tvalue" })).not.toMatch(/[\n\t]/);
        const rows = projectP2PDiagnosticRows({ peer: { ...peerLeft, timestamp: NaN } });
        expect(rows[1].time).toBe("");
        expect(formatP2PDiagnosticLog({ ...peerLeft, timestamp: NaN })).toContain("unknown time");
    });
});
