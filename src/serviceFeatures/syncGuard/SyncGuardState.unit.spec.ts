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
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:two"]);
        guard.catchUpSucceeded();
        guard.catchUpActivityChanged(false, 0, 10);
        expect(guard.presentation.phase).toBe("idle");
    });

    it("counts distinct Metadata rather than repeated changes and waits for local application", () => {
        const { guard } = setup();
        guard.resume(true, 3);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:one", "f:two"]);
        expect(guard.presentation.phase).toBe("observing");
        guard.receivedDocuments(["f:three"]);
        expect(guard.presentation).toEqual({ phase: "transferring", receivedFiles: 3 });
        guard.receivedDocuments(["f:four", "f:four"]);
        expect(guard.presentation.receivedFiles).toBe(4);
        guard.catchUpSucceeded();
        guard.catchUpActivityChanged(false, 2, 10);
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
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:two"]);
        guard.catchUpActivityChanged(false, 0, 10);
        expect(guard.presentation.phase).toBe("interrupted");
        guard.bypass();
        expect(guard.presentation.phase).toBe("idle");
        guard.receivedDocuments(["f:other"]);
        expect(guard.presentation.phase).toBe("idle");
    });

    it("expires the manual bypass when its catch-up completes and protects the next catch-up", () => {
        const { guard } = setup();
        guard.resume(true, 2);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["first", "second"]);
        expect(guard.presentation.phase).toBe("transferring");
        guard.bypass();
        expect(guard.wasBypassed).toBe(true);
        guard.catchUpActivityChanged(true, 0, 5);
        expect(guard.isCatchUpActive).toBe(true);
        guard.catchUpSucceeded();
        guard.catchUpActivityChanged(false, 0, 10);
        expect(guard.isCatchUpActive).toBe(false);
        expect(guard.wasBypassed).toBe(false);
        expect(guard.presentation.phase).toBe("idle");

        guard.resume(true, 2);
        guard.catchUpActivityChanged(true, 0, 20);
        guard.receivedDocuments(["another-first", "another-second"]);
        expect(guard.presentation).toEqual({ phase: "transferring", receivedFiles: 2 });
    });

    it("does not unlock when a new pull starts while applying an earlier completed transfer", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:first"]);
        guard.catchUpSucceeded();
        guard.catchUpActivityChanged(false, 0, 1);
        expect(guard.presentation.phase).toBe("applying");
        guard.catchUpActivityChanged(true, 0, 100);
        expect(guard.presentation.phase).toBe("transferring");
        guard.tick(0, 10_000);
        expect(guard.presentation.phase).toBe("transferring");
        guard.catchUpActivityChanged(false, 0, 10_001);
        expect(guard.presentation.phase).toBe("interrupted");
    });

    it("can recover an interrupted catch-up when a new pull succeeds", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:first"]);
        guard.catchUpActivityChanged(false, 0, 10);
        expect(guard.presentation.phase).toBe("interrupted");
        guard.catchUpActivityChanged(true, 0, 20);
        expect(guard.presentation.phase).toBe("transferring");
        guard.catchUpSucceeded();
        guard.catchUpActivityChanged(false, 0, 30);
        guard.tick(0, 2030);
        expect(guard.presentation.phase).toBe("idle");
    });

    it("does not declare the Vault ready after a failed received-file reflection", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:first"]);
        guard.reflectionFailed();
        guard.catchUpSucceeded();
        guard.catchUpActivityChanged(false, 0, 10);
        guard.tick(0, 10_000);
        expect(guard.presentation.phase).toBe("interrupted");
        guard.bypass();
        expect(guard.presentation.phase).toBe("idle");
    });

    it("does not treat a stale completion as success for a new catch-up", () => {
        const { guard } = setup();
        guard.resume(true, 1);
        guard.catchUpSucceeded();
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one"]);
        guard.catchUpActivityChanged(false, 0, 1);
        expect(guard.presentation.phase).toBe("interrupted");
    });

    it("resets after resume and is opt-in", () => {
        const { guard } = setup();
        guard.resume(false, 1);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("idle");
        guard.resume(true, 1);
        guard.catchUpActivityChanged(true, 0, 10);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("transferring");
        guard.disable();
        expect(guard.presentation.phase).toBe("idle");
    });

    it("handles NaN and negative thresholds conservatively", () => {
        const { guard } = setup();
        guard.resume(true, NaN);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("observing");
        guard.resume(true, -2);
        guard.catchUpActivityChanged(true, 0, 10);
        guard.receivedDocuments(["f:one"]);
        expect(guard.presentation.phase).toBe("transferring");
    });

    it("applies a lowered threshold while observing without unlocking an already protected Vault", () => {
        const { guard } = setup();
        guard.resume(true, 20);
        guard.catchUpActivityChanged(true, 0, 0);
        guard.receivedDocuments(["f:one", "f:two", "f:three"]);
        guard.updateThreshold(3);
        expect(guard.presentation.phase).toBe("transferring");
        guard.updateThreshold(200);
        expect(guard.presentation.phase).toBe("transferring");
    });
});
