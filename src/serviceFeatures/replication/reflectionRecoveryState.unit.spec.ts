import { describe, expect, it, vi } from "vitest";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import type { DocumentID } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ContentReadFailure } from "@vrtmrz/livesync-commonlib/replication";
import { ReflectionRecoveryState, type ReflectionSnapshot } from "./reflectionRecoveryState";

function recoveryState(canRetryResource: (resource: "local-database" | "remote") => boolean = () => true) {
    return new ReflectionRecoveryState({
        canRetainFailures: () => true,
        canRetryResource,
        isApplicationReady: () => true,
        isWaitingForReset: () => false,
        onListenerError: vi.fn(),
    });
}

function failure(
    revision = "1-first",
    documentId = "note",
    resources: readonly ("local-database" | "remote")[] = ["remote"]
): ContentReadFailure {
    return {
        documentId: documentId as DocumentID,
        revision,
        resources,
        cause: new Error("read failed"),
    } as unknown as ContentReadFailure;
}

describe("reflection target scopes", () => {
    it("issues ordinary work without creating pending state or consuming an allowance", async () => {
        const state = recoveryState();
        const changed = vi.fn();
        state.onChanged(changed);
        const scope = state.issue("note");
        expect(
            await scope.run(async () => {
                scope.checkpoint();
                return "applied";
            })
        ).toBe("applied");
        expect(state.list()).toEqual([]);
        expect(state.snapshot()).toEqual({});
        expect(changed).not.toHaveBeenCalled();
    });

    it("invalidates earlier scopes on reset even if durable reset must roll back", async () => {
        const state = recoveryState();
        const scope = state.issue("note");
        scope.retainFailure(failure());
        const reset = state.beginReset();
        reset.rollback();
        const reflected = vi.fn();
        await scope.run(async () => {
            scope.checkpoint();
            reflected();
        });
        expect(reflected).not.toHaveBeenCalled();
        expect(state.list()).toHaveLength(1);
        const next = state.issue("note");
        expect(
            await next.run(async () => {
                next.checkpoint();
                return "current";
            })
        ).toBe("current");
    });

    it("waits for started work after stop and preserves its actual rejection", async () => {
        const state = recoveryState();
        const scope = state.issue("note");
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
        state.stop();
        expect(settled).not.toHaveBeenCalled();
        io.reject(error);
        await result;
        expect(settled).toHaveBeenCalledTimes(1);
        expect(scope.retainFailure(failure())).toBeUndefined();
    });

    it("keeps continuation and failure-retention rules distinct when a newer pending record arrives", async () => {
        const state = recoveryState();
        const ordinary = state.issue("note");
        const first = ordinary.retainFailure(failure())!;
        state.resourceRecovered("remote");
        const attempt = state.admit(first, "automatic")!;
        const recovery = state.issue("note", attempt);
        state.issue("note").retainFailure(failure("2-current"));
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
        state.finishAttempt(attempt);
        expect(state.list()).toMatchObject([{ revision: "2-current", automaticAttempted: false, state: "waiting" }]);
    });

    it("retains same-revision failures without refunding a previously consumed allowance", () => {
        const state = recoveryState();
        const scope = state.issue("note");
        const record = scope.retainFailure(failure())!;
        state.resourceRecovered("remote");
        const attempt = state.admit(record, "automatic")!;
        state.finishAttempt(attempt);
        expect(scope.retainFailure(failure("1-first", "note", ["local-database"]))).toBe(record);
        expect(state.canAdmit(record, "automatic")).toBe(false);
    });

    it("keeps pending record identity private to its owner and retires inspection after removal", async () => {
        const firstOwner = recoveryState();
        const secondOwner = recoveryState();
        const first = firstOwner.issue("note");
        const second = secondOwner.issue("note");
        const record = first.retainFailure(failure())!;
        const inspection = firstOwner.inspect(record);
        firstOwner.remove(record);
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
        const state = recoveryState();
        const record = state.issue("note").retainFailure(failure())!;
        state.resourceRecovered("remote");
        state.admit(record, "automatic");
        const snapshot = state.snapshot();
        const restored = recoveryState();
        const keepQueued = restored.restore(snapshot);
        expect(keepQueued("note", "1-first")).toBe(false);
        expect(keepQueued("note", "2-current")).toBe(true);
        expect(restored.list()).toMatchObject([{ state: "review", reason: "interrupted", automaticAttempted: true }]);
        restored.issue("note").retainFailure(failure("1-first", "note", ["local-database"]));
        expect(snapshot.pendingReflections?.[0].resources).toEqual([]);
        expect(state.list()[0].resources).toEqual([]);
    });

    it("retains an unclassified failure for review without granting an automatic retry", () => {
        const state = recoveryState();
        const record = state.issue("note").retainFailure(failure("1-first", "note", []));
        expect(record).toMatchObject({ state: "review", resources: [] });
        expect(state.admit(record!, "automatic")).toBeUndefined();
        expect(state.list()).toHaveLength(1);
    });

    it.each([{ resources: [] }, { resources: ["remote"] }, { resources: ["local-database"] }] as const)(
        "does not retain internal Metadata after a $resources content failure",
        ({ resources }) => {
            const state = recoveryState();
            const scope = state.issue("i:hidden-file");
            expect(scope.retainFailure(failure("1-first", "i:hidden-file", resources))).toBeUndefined();
            expect(state.list()).toEqual([]);
        }
    );

    it("waits for every failed resource before admitting one retry and preserves its allowance", () => {
        const state = recoveryState();
        const record = state.issue("note").retainFailure(failure("1-first", "note", ["local-database", "remote"]))!;
        expect(state.admit(record, "automatic")).toBeUndefined();
        state.resourceRecovered("local-database");
        expect(state.get("note")?.resources).toEqual(["remote"]);
        expect(state.admit(record, "automatic")).toBeUndefined();
        state.resourceRecovered("remote");
        const attempt = state.admit(record, "automatic");
        expect(attempt).toBeDefined();
        expect(state.get("note")?.automaticAttempted).toBe(true);
        state.finishAttempt(attempt!);
        const restored = recoveryState();
        restored.restore(state.snapshot());
        expect(restored.admit(restored.get("note")!, "automatic")).toBeUndefined();
    });

    it("clears a prerequisite only when the owner confirms that resource can retry", () => {
        const state = recoveryState((resource) => resource !== "remote");
        const record = state.issue("note").retainFailure(failure("1-first", "note", ["remote"]))!;
        expect(state.resourceRecovered("remote")).toBe(false);
        expect(state.get("note")?.resources).toEqual(["remote"]);
        expect(state.admit(record, "automatic")).toBeUndefined();
    });

    it("upgrades legacy retry reasons into resource prerequisites and keeps unknowns for review", () => {
        const snapshot = {
            pendingReflections: [
                {
                    documentId: "local",
                    revision: "1",
                    source: "received",
                    state: "waiting",
                    automaticAttempted: false,
                    reason: "local-database",
                },
                {
                    documentId: "remote",
                    revision: "1",
                    source: "received",
                    state: "waiting",
                    automaticAttempted: false,
                    reason: "transport",
                },
                {
                    documentId: "unknown",
                    revision: "1",
                    source: "scan",
                    state: "waiting",
                    automaticAttempted: false,
                    reason: "content-invalid",
                },
            ],
        } as unknown as ReflectionSnapshot;
        const restored = recoveryState();
        restored.restore(snapshot);
        expect(restored.get("local")).toMatchObject({ resources: ["local-database"], state: "waiting" });
        expect(restored.get("remote")).toMatchObject({ resources: ["remote"], state: "waiting" });
        expect(restored.get("unknown")).toMatchObject({ resources: [], state: "review" });
    });

    it("ignores malformed headers and keeps unknown stored resources unclassified", () => {
        const snapshot = {
            pendingReflections: [
                {
                    documentId: "malformed",
                    revision: "1",
                    source: "received",
                    state: "waiting",
                    automaticAttempted: false,
                    resources: ["remote"],
                },
                {
                    documentId: "unknown-resource",
                    revision: "1",
                    source: "received",
                    state: "waiting",
                    automaticAttempted: false,
                    reason: "remote",
                    resources: ["future-resource"],
                },
            ],
        } as unknown as ReflectionSnapshot;
        const restored = recoveryState();

        restored.restore(snapshot);

        expect(restored.list()).toMatchObject([
            { documentId: "unknown-resource", resources: [], state: "review", reason: "unavailable" },
        ]);
    });

    it("publishes review-state changes once at each owning transition", () => {
        const state = recoveryState();
        const record = state.issue("note").retainFailure(failure())!;
        const changed = vi.fn();
        state.onChanged(changed);

        state.markForReview(record, "manual-review");
        expect(changed).toHaveBeenCalledTimes(1);
        expect(record).toMatchObject({ state: "review", reason: "manual-review" });

        const attempt = state.admit(record, "manual")!;
        expect(changed).toHaveBeenCalledTimes(1);
        state.finishAttempt(attempt, "manual-failed");
        expect(changed).toHaveBeenCalledTimes(2);
        expect(record).toMatchObject({ state: "review", reason: "manual-failed" });

        state.finishAttempt(attempt, "stale-finish");
        state.markForReview(undefined, "no-current-target");
        expect(changed).toHaveBeenCalledTimes(3);
    });

    it("does not swallow another scope's exit as its own", async () => {
        const state = recoveryState();
        const obsolete = state.issue("note");
        state.beginReset();
        const current = state.issue("note");
        await expect(
            current.run(async () => {
                obsolete.checkpoint();
            })
        ).rejects.toBeInstanceOf(Error);
    });
});
