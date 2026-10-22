import { describe, expect, it, vi } from "vitest";
import { SyncGuardState, type SyncGuardPresentation } from "./SyncGuardState";

describe("SyncGuardState", () => {
    function setup() {
        const presentations: SyncGuardPresentation[] = [];
        const onChange = vi.fn((value: SyncGuardPresentation) => presentations.push(value));
        const guard = new SyncGuardState(onChange, 2000);
        return { guard, onChange, presentations };
    }

    it("never locks for a small incoming change batch", () => {
        const { guard } = setup();
        guard.resume(true, 20);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:two"]);
        guard.replicationStatusChanged("COMPLETED");
        guard.finiteActivityChanged(false, 0, 10);
        expect(guard.presentation.phase).toBe("idle");
    });

    it("counts distinct Metadata rather than repeated changes and waits for local application", () => {
        const { guard } = setup();
        guard.resume(true, 3);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:one", "f:two"]);
        expect(guard.presentation.phase).toBe("observing");
        guard.receivedDocuments(["f:three"]);
        expect(guard.presentation).toEqual({ phase: "transferring", receivedFiles: 3 });
        guard.receivedDocuments(["f:four", "f:four"]);
        expect(guard.presentation.receivedFiles).toBe(4);
        guard.replicationStatusChanged("COMPLETED");
        guard.finiteActivityChanged(false, 2, 10);
        expect(guard.presentation.phase).toBe("applying");
        guard.tick(0, 20);
        guard.tick(1, 2000);
        guard.tick(0, 2100);
        guard.tick(0, 4099);
        expect(guard.presentation.phase).toBe("applying");
        guard.tick(0, 4100);
        expect(guard.presentation.phase).toBe("idle");
    });

    it("keeps the lock with an interrupted transfer until the user bypasses it", () => {
        const { guard } = setup();
        guard.resume(true, 2);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:two"]);
        guard.replicationStatusChanged("ERRORED");
        guard.finiteActivityChanged(false, 0, 10);
        expect(guard.presentation.phase).toBe("interrupted");
        guard.bypass();
        expect(guard.presentation.phase).toBe("idle");
        guard.receivedDocuments(["f:other"]);
        expect(guard.presentation.phase).toBe("idle");
    });

    it("does not unlock when a new pull starts while applying an earlier completed transfer", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:first"]);
        guard.replicationStatusChanged("COMPLETED");
        guard.finiteActivityChanged(false, 0, 1);
        expect(guard.presentation.phase).toBe("applying");
        guard.finiteActivityChanged(true, 0, 100);
        expect(guard.presentation.phase).toBe("transferring");
        guard.tick(0, 10_000);
        expect(guard.presentation.phase).toBe("transferring");
        guard.finiteActivityChanged(false, 0, 10_001);
        expect(guard.presentation.phase).toBe("interrupted");
    });

    it("can recover an interrupted catch-up when a new pull succeeds", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:first"]);
        guard.finiteActivityChanged(false, 0, 10);
        expect(guard.presentation.phase).toBe("interrupted");
        guard.finiteActivityChanged(true, 0, 20);
        expect(guard.presentation.phase).toBe("transferring");
        guard.replicationStatusChanged("COMPLETED");
        guard.finiteActivityChanged(false, 0, 30);
        guard.tick(0, 2030);
        expect(guard.presentation.phase).toBe("idle");
    });

    it("does not declare the Vault ready after a failed received-file reflection", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:first"]);
        guard.reflectionFailed();
        guard.replicationStatusChanged("COMPLETED");
        guard.finiteActivityChanged(false, 0, 10);
        guard.tick(0, 10_000);
        expect(guard.presentation.phase).toBe("interrupted");
        guard.bypass();
        expect(guard.presentation.phase).toBe("idle");
    });

    it("does not confuse a stale completed status with this catch-up", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.replicationStatusChanged("COMPLETED");
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one"]);
        guard.finiteActivityChanged(false, 0, 1);
        expect(guard.presentation.phase).toBe("interrupted");
    });

    it("resets after resume and is opt-in", () => {
        const { guard } = setup();
        guard.resume(false, 1);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("idle");
        guard.resume(true, 1);
        guard.finiteActivityChanged(true, 0, 10);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("transferring");
        guard.disable();
        expect(guard.presentation.phase).toBe("idle");
    });

    it("handles NaN and negative thresholds conservatively", () => {
        const { guard } = setup();
        guard.resume(true, NaN);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("observing");
        guard.resume(true, -2);
        guard.finiteActivityChanged(true, 0, 10);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("transferring");
    });

    it("applies a lowered threshold while observing without unlocking an already protected Vault", () => {
        const { guard } = setup();
        guard.resume(true, 20);
        guard.finiteActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:two", "f:three"]);
        guard.updateThreshold(3);
        expect(guard.presentation.phase).toBe("transferring");
        guard.updateThreshold(200);
        expect(guard.presentation.phase).toBe("transferring");
    });
});
