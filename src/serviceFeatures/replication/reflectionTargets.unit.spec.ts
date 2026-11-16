import { describe, expect, it, vi } from "vitest";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import type { DocumentID } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ContentReadFailure } from "@vrtmrz/livesync-commonlib/replication";
import { ReflectionTargets } from "./reflectionTargets";

function owner() {
    return new ReflectionTargets({
        canDeferFailure: () => true,
        isApplicationReady: () => true,
        isWaitingForReset: () => false,
        onListenerError: vi.fn(),
    });
}

function failure(revision = "1-first", documentId = "note"): ContentReadFailure {
    return { documentId: documentId as DocumentID, revision, reason: "transport" };
}

describe("reflection target scopes", () => {
    it("issues ordinary work without creating pending state or consuming an allowance", async () => {
        const targets = owner();
        const changed = vi.fn();
        targets.onChanged(changed);
        const scope = targets.issue("note");
        expect(
            await scope.run(async () => {
                scope.checkpoint();
                return "applied";
            })
        ).toBe("applied");
        expect(targets.list()).toEqual([]);
        expect(targets.snapshot()).toEqual({});
        expect(changed).not.toHaveBeenCalled();
    });

    it("invalidates earlier scopes on reset even if durable reset must roll back", async () => {
        const targets = owner();
        const scope = targets.issue("note");
        scope.retainFailure(failure());
        const reset = targets.beginReset();
        reset.rollback();
        const reflected = vi.fn();
        await scope.run(async () => {
            scope.checkpoint();
            reflected();
        });
        expect(reflected).not.toHaveBeenCalled();
        expect(targets.list()).toHaveLength(1);
        const next = targets.issue("note");
        expect(
            await next.run(async () => {
                next.checkpoint();
                return "current";
            })
        ).toBe("current");
    });

    it("waits for started work after stop and preserves its actual rejection", async () => {
        const targets = owner();
        const scope = targets.issue("note");
        const io = promiseWithResolvers<void>();
        const started = promiseWithResolvers<void>();
        const settled = vi.fn();
        const error = new Error("read failed");
        const operation = scope
            .run(async () => {
                scope.checkpoint();
                started.resolve();
                await io.promise;
                scope.checkpoint();
            })
            .finally(settled);
        const result = expect(operation).rejects.toBe(error);
        await started.promise;
        targets.stop();
        expect(settled).not.toHaveBeenCalled();
        io.reject(error);
        await result;
        expect(settled).toHaveBeenCalledTimes(1);
        expect(scope.retainFailure(failure())).toBeUndefined();
    });

    it("keeps continuation and failure-retention rules distinct when a newer target arrives", async () => {
        const targets = owner();
        const ordinary = targets.issue("note");
        const first = ordinary.retainFailure(failure())!;
        const attempt = targets.admit(first, "automatic", "remote")!;
        const recovery = targets.issue("note", attempt);
        targets.issue("note").retainFailure(failure("2-current"));
        const continued = vi.fn();
        await ordinary.run(async () => {
            ordinary.checkpoint();
            continued("ordinary");
        });
        await recovery.run(async () => {
            recovery.checkpoint();
            continued("recovery");
        });
        expect(continued.mock.calls).toEqual([["ordinary"]]);
        expect(ordinary.retainFailure(failure())).toBeUndefined();
        targets.finishAttempt(attempt);
        expect(targets.list()).toMatchObject([{ revision: "2-current", automaticAttempted: false, state: "waiting" }]);
    });

    it("retains same-revision failures without refunding a previously consumed allowance", () => {
        const targets = owner();
        const scope = targets.issue("note");
        const target = scope.retainFailure(failure())!;
        const attempt = targets.admit(target, "automatic", "remote")!;
        targets.finishAttempt(attempt);
        expect(scope.retainFailure({ ...failure(), reason: "local-database" })).toBe(target);
        expect(targets.canAdmit(target, "automatic", "local-database")).toBe(false);
    });

    it("keeps target identity private to its owner and retires inspection after removal", async () => {
        const firstOwner = owner();
        const secondOwner = owner();
        const first = firstOwner.issue("note");
        const second = secondOwner.issue("note");
        const target = first.retainFailure(failure())!;
        const inspection = firstOwner.inspect(target);
        firstOwner.remove(target);
        const inspect = vi.fn();
        await inspection.run(async () => {
            inspection.checkpoint();
            inspect();
        });
        expect(inspect).not.toHaveBeenCalled();
        firstOwner.stop();
        expect(
            await second.run(async () => {
                second.checkpoint();
                return "current";
            })
        ).toBe("current");
    });

    it("restores consumed attempts as review work while keeping ordinary queued revisions", () => {
        const targets = owner();
        const target = targets.issue("note").retainFailure(failure())!;
        targets.admit(target, "automatic", "remote");
        const snapshot = targets.snapshot();
        const restored = owner();
        const keepQueued = restored.restore(snapshot);
        expect(keepQueued("note", "1-first")).toBe(false);
        expect(keepQueued("note", "2-current")).toBe(true);
        expect(restored.list()).toMatchObject([{ state: "review", reason: "interrupted", automaticAttempted: true }]);
        restored.issue("note").retainFailure({ ...failure(), reason: "local-database" });
        expect(snapshot.pendingReflections?.[0].reason).toBe("transport");
        expect(targets.list()[0].reason).toBe("transport");
    });

    it("does not swallow another scope's exit as its own", async () => {
        const targets = owner();
        const obsolete = targets.issue("note");
        targets.beginReset();
        const current = targets.issue("note");
        await expect(
            current.run(async () => {
                obsolete.checkpoint();
            })
        ).rejects.toBeInstanceOf(Error);
    });
});
