import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { P2PReplicationProgress } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicator";
import type { P2PDiagnostics } from "@vrtmrz/livesync-commonlib/p2p";
import {
    observeP2PDiagnosticsProgress,
    createP2PProgressDisplay,
    selectReplicationStatus,
    type P2PStatusProjection,
} from "./P2PStatusLabel.ts";

function peer(peerId = "peer-a"): P2PReplicationProgress {
    return {
        peerId,
        peerName: peerId,
        sending: { current: 800, max: 900, isActive: true, statistics: { documents: 2, checkedChanges: 40 } },
        fetching: { current: 600, max: 700, isActive: true, statistics: { documents: 0, checkedChanges: 33 } },
    };
}

describe("P2P progress display", () => {
    const disposables: { dispose(): void }[] = [];
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        for (const display of disposables.splice(0)) display.dispose();
        vi.useRealTimers();
    });
    function displayFor(initial: P2PReplicationProgress[] = [peer()]) {
        const source = reactiveSource<readonly P2PReplicationProgress[]>(initial);
        const display = createP2PProgressDisplay(source);
        disposables.push(display);
        return { source, display };
    }

    it("shows transferred revisions independently from seq and zero-transfer comparisons", () => {
        const { display, source } = displayFor();
        expect(display.value.message).toBe("⚡ peer-a ↑ 2 ⏩↑ 40 ↓ 0 ⏩↓ 33");
        expect(display.value.parts.find((part) => part.key === "p2p-peer-a-fetching")).toMatchObject({ value: 0 });
        vi.advanceTimersByTime(3_000);
        expect(display.value.message).toBe("⚡ peer-a ↑ 2 ↓ 0");
        expect(source.value[0].fetching.statistics).toEqual({ documents: 0, checkedChanges: 33 });
    });

    it("labels legacy seq honestly and distinguishes unavailable counts from measured zero", () => {
        const legacy = peer();
        delete legacy.sending.statistics;
        const { display } = displayFor([legacy]);
        expect(display.value.message).toContain("↑ seq 800 (900)");
        expect(display.value.message).toContain("↓ 0 ⏩↓ 33");
        expect(display.value.message).not.toContain("⏩↑");
    });

    it("expires independently by direction and peer without extending on unrelated activity", () => {
        const { display, source } = displayFor([peer(), peer("peer-b")]);
        vi.advanceTimersByTime(2_000);
        const next = peer();
        next.fetching.statistics = { documents: 0, checkedChanges: 66 };
        source.value = [next, peer("peer-b")];
        vi.advanceTimersByTime(1_000);
        expect(display.value.peers.get("peer-a")?.message).toBe("↑ 2 ↓ 0 ⏩↓ 66");
        expect(display.value.peers.get("peer-b")?.message).toBe("↑ 2 ↓ 0");
        source.value = [{ ...next, peerName: "renamed" }, peer("peer-b")];
        vi.advanceTimersByTime(2_000);
        expect(display.value.message).not.toContain("⏩");
        source.value = [next, peer("peer-b")];
        expect(display.value.message).not.toContain("⏩");
    });

    it("starts a fresh label lifetime after a counter reset and retains terminal transfer totals", () => {
        const { display, source } = displayFor();
        const reset = peer();
        reset.fetching.statistics = { documents: 0, checkedChanges: 0 };
        source.value = [reset];
        expect(display.value.message).not.toContain("⏩↓");
        vi.advanceTimersByTime(3_000);
        const completed = peer();
        completed.sending.isActive = false;
        completed.fetching.isActive = false;
        source.value = [completed];
        expect(display.value.message).toBe("💤 peer-a ↑ 2 ↓ 0 ⏩↓ 33");
        vi.advanceTimersByTime(3_000);
        expect(display.value.message).toBe("💤 peer-a ↑ 2 ↓ 0");
    });

    it("removes labels and pending timers on disconnect, and detaches on disposal", () => {
        const { display, source } = displayFor();
        source.value = [];
        expect(display.value.message).toBe("");
        expect(vi.getTimerCount()).toBe(0);
        source.value = [peer()];
        expect(display.value.message).toContain("⏩↓ 33");
        display.dispose();
        const last = display.value;
        source.value = [];
        vi.advanceTimersByTime(5_000);
        expect(display.value).toBe(last);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("takes a late diagnostics snapshot, follows updates, and unsubscribes for either pane", () => {
        let listener: ((snapshot: readonly P2PReplicationProgress[]) => void) | undefined;
        const unsubscribe = vi.fn();
        const diagnostics: P2PDiagnostics = {
            requestStatus: vi.fn(),
            getPeerConnectionMetrics: vi.fn(),
            getReplicationProgress: () => [peer()],
            onReplicationProgress: (handler) => {
                listener = handler;
                return unsubscribe;
            },
        };
        let snapshot: P2PStatusProjection | undefined;
        const dispose = observeP2PDiagnosticsProgress(diagnostics, (value) => {
            snapshot = value;
        });
        disposables.push({ dispose });
        expect(snapshot?.peers.get("peer-a")?.message).toContain("↓ 0 ⏩↓ 33");
        listener?.([]);
        expect(snapshot?.peers.size).toBe(0);
        dispose();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it("supports diagnostics from an older service without progress methods", () => {
        const listener = vi.fn();
        const dispose = observeP2PDiagnosticsProgress(
            { requestStatus: vi.fn(), getPeerConnectionMetrics: vi.fn() },
            listener
        );
        disposables.push({ dispose });
        expect(listener).toHaveBeenLastCalledWith({ message: "", parts: [], peers: new Map() });
    });

    it("uses P2P for the Only P2P primary display and preserves the CouchDB display when auxiliary", () => {
        const { display } = displayFor();
        const couchDB = { message: "Sync: ⚡ ↑ 12 ↓ 34", parts: [{ key: "sent", text: " ↑ ", value: 12 }] };
        const auxiliary = selectReplicationStatus(couchDB, display.value, false);
        expect(auxiliary.primary).toBe(couchDB);
        expect(auxiliary.auxiliary.message).toContain("↑ 2");
        const onlyP2P = selectReplicationStatus(couchDB, display.value, true);
        expect(onlyP2P.primary.message).toBe("Sync: ⚡ peer-a ↑ 2 ⏩↑ 40 ↓ 0 ⏩↓ 33");
        expect(onlyP2P.auxiliary.message).toBe("");
        expect(couchDB.parts[0].value).toBe(12);
        expect(
            selectReplicationStatus(couchDB, { message: "", parts: [], peers: new Map() }, true).primary.message
        ).toBe("Sync: 💤 P2P");
    });
});
