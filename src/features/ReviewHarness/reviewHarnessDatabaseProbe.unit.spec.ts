import { describe, expect, it, vi } from "vitest";
import {
    ReviewHarnessDatabaseProbeController,
    type DatabaseProbeEvent,
    type DatabaseProbeFixture,
    type DatabaseProbeRuntime,
} from "./reviewHarnessDatabaseProbe";
import { awaitDatabaseProbeOperation, databaseProbeErrorName } from "./reviewHarnessDatabaseProbeRuntime";

function setup() {
    let emit: (event: DatabaseProbeEvent) => void = () => {};
    let lost = false;
    const fixture: DatabaseProbeFixture = {
        check: vi.fn(async () => ({
            observations: [lost ? "retained.get=error; name=InvalidStateError" : "retained.get=ok"],
            connectionFailure: lost,
        })),
        closeNative: vi.fn(() => {
            lost = true;
        }),
        reopen: vi.fn(async () => {
            lost = false;
            return {
                observations: ["retained.get=ok; contentMatches=true; revisionMatches=true"],
                connectionFailure: false,
            };
        }),
        cleanup: vi.fn(async () => {}),
    };
    const unobserve = vi.fn();
    const runtime: DatabaseProbeRuntime = {
        now: () => new Date("2026-11-16T00:00:00.000Z"),
        confirmStart: vi.fn(async () => true),
        createFixture: vi.fn(async () => fixture),
        observeLifecycle: vi.fn((handler) => {
            emit = handler;
            emit({
                source: "document",
                name: "visibilitychange",
                registration: "registered",
                detail: "handlerProperty=true",
            });
            emit({ source: "active-local-native", name: "close", registration: "unavailable" });
            return unobserve;
        }),
        inspectActiveDatabase: vi.fn(async () => ({
            observations: ["active-local.info=ok"],
            connectionFailure: false,
        })),
    };
    return {
        probe: new ReviewHarnessDatabaseProbeController(runtime),
        runtime,
        fixture,
        unobserve,
        emit: (event: DatabaseProbeEvent) => emit(event),
    };
}

describe("guided database event observation", () => {
    it("does not count a baseline active database failure as controlled fixture reproduction", async () => {
        const { probe, runtime } = setup();
        vi.mocked(runtime.inspectActiveDatabase).mockResolvedValue({
            observations: ["active-local.info=error; name=InvalidStateError"],
            connectionFailure: true,
        });

        await probe.start("controlled");
        await probe.perform("finish");

        expect(probe.snapshot().result).toMatchObject({ status: "not-observed" });
        expect(probe.snapshot().result.observations).toContain(
            "fixture sample; stage=baseline; sampledAt=2026-11-16T00:00:00.000Z; retained.get=ok"
        );
        expect(probe.snapshot().result.observations).toContain(
            "active sample; stage=baseline; sampledAt=2026-11-16T00:00:00.000Z; active-local.info=error; name=InvalidStateError"
        );
    });

    it("keeps an unsupported fixture outcome when the active database check fails", async () => {
        const { probe, runtime } = setup();
        vi.mocked(runtime.createFixture).mockRejectedValue(new Error("fixture unavailable"));
        vi.mocked(runtime.inspectActiveDatabase).mockResolvedValue({
            observations: ["active-local.info=error; name=InvalidStateError"],
            connectionFailure: true,
        });

        await probe.start("controlled");
        await probe.perform("finish");

        expect(probe.snapshot().result.status).toBe("unsupported");
        expect(probe.snapshot().result.observations).toContain(
            "active sample; stage=baseline; sampledAt=2026-11-16T00:00:00.000Z; active-local.info=error; name=InvalidStateError"
        );
    });

    it("retains registration, zero receipt, and unavailable-handle evidence without a reproduced failure", async () => {
        const { probe, unobserve } = setup();
        await probe.start("background");
        expect(probe.snapshot().availableActions).not.toContain("close-native");
        await probe.perform("finish");
        const result = probe.snapshot().result;
        expect(result.status).toBe("not-observed");
        expect(result.observations).toContain(
            "document.visibilitychange: listener=registered; received=0; last=none; handlerProperty=true"
        );
        expect(result.observations).toContain("active-local-native.close: listener=unavailable; received=0; last=none");
        expect(unobserve).toHaveBeenCalledOnce();
    });

    it("publishes received event counts and timestamps while waiting for the reviewer", async () => {
        const { probe, emit } = setup();
        const updated = vi.fn();
        probe.subscribe(updated);
        await probe.start("background");
        emit({ source: "document", name: "visibilitychange", detail: "visibility=hidden" });
        emit({ source: "document", name: "visibilitychange", detail: "visibility=visible" });
        expect(probe.snapshot().result.observations).toContain(
            "document.visibilitychange: listener=registered; received=2; last=2026-11-16T00:00:00.000Z; lastStage=background-transition; handlerProperty=true"
        );
        expect(probe.snapshot().result.observations).toContain(
            "2026-11-16T00:00:00.000Z stage=background-transition event=received document.visibilitychange: visibility=hidden"
        );
        expect(probe.snapshot().result.observations).toContain(
            "2026-11-16T00:00:00.000Z stage=baseline registration=registered document.visibilitychange: handlerProperty=true"
        );
        expect(probe.snapshot().phase).toBe("observing");
        expect(updated).toHaveBeenCalled();
        await probe.perform("check");
        await probe.perform("finish");
        expect(probe.snapshot().result.status).toBe("not-observed");
    });

    it("separates controlled reproduction and diagnostic reopen from automatic recovery", async () => {
        const { probe, fixture } = setup();
        await probe.start("controlled");
        expect(probe.snapshot().result.observations).toContain(
            "fixture sample; stage=baseline; sampledAt=2026-11-16T00:00:00.000Z; retained.get=ok"
        );
        await probe.perform("close-native");
        expect(fixture.closeNative).toHaveBeenCalledOnce();
        expect(probe.snapshot().result.status).toBe("waiting-for-user");
        expect(probe.snapshot().result.observations).toContain(
            "fixture sample; stage=after-native-close; sampledAt=2026-11-16T00:00:00.000Z; retained.get=error; name=InvalidStateError"
        );
        expect(probe.snapshot().availableActions).toContain("reopen");
        await probe.perform("reopen");
        expect(probe.snapshot().result.observations).toContain(
            "fixture sample; stage=after-explicit-reopen; sampledAt=2026-11-16T00:00:00.000Z; retained.get=ok; contentMatches=true; revisionMatches=true"
        );
        await probe.perform("finish");
        expect(probe.snapshot().result).toMatchObject({
            status: "passed",
            detail: expect.stringContaining("not automatic recovery"),
        });
        expect(fixture.cleanup).toHaveBeenCalledOnce();
    });

    it("does not create a database when confirmation is declined", async () => {
        const { probe, runtime } = setup();
        vi.mocked(runtime.confirmStart).mockResolvedValue(false);
        await probe.start("controlled");
        expect(runtime.createFixture).not.toHaveBeenCalled();
        expect(runtime.observeLifecycle).not.toHaveBeenCalled();
        expect(probe.snapshot().result.status).toBe("cancelled");
    });

    it("does not mix late callbacks from a completed run into a new observation", async () => {
        const { probe, runtime } = setup();
        await probe.start("background");
        const oldEmit = vi.mocked(runtime.observeLifecycle).mock.calls[0][0];
        await probe.perform("finish");
        await probe.start("background");
        oldEmit({ source: "document", name: "visibilitychange", detail: "visibility=hidden" });
        expect(probe.snapshot().result.observations).toContain(
            "document.visibilitychange: listener=registered; received=0; last=none; handlerProperty=true"
        );
        await probe.dispose();
    });

    it("retains available event evidence after native capture cannot be prepared", async () => {
        const { probe, runtime, unobserve } = setup();
        vi.mocked(runtime.createFixture).mockRejectedValue(new Error("private-vault/secret-note.md"));
        await probe.start("background");
        expect(probe.snapshot().phase).toBe("observing");
        expect(JSON.stringify(probe.snapshot())).not.toContain("secret-note");
        expect(probe.snapshot().result.observations.join("\n")).toContain("visibilitychange");
        expect(unobserve).not.toHaveBeenCalled();
        await probe.perform("finish");
        expect(probe.snapshot().result.status).toBe("unsupported");
        expect(unobserve).toHaveBeenCalledOnce();
    });

    it("waits for cancelled setup to return its owned fixture before cleanup", async () => {
        const { probe, runtime, fixture, unobserve } = setup();
        let finishCreation!: (value: DatabaseProbeFixture) => void;
        vi.mocked(runtime.createFixture).mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishCreation = resolve;
                })
        );
        const started = probe.start("background");
        await vi.waitFor(() => expect(runtime.createFixture).toHaveBeenCalledOnce());
        const cancelled = probe.perform("cancel");
        finishCreation(fixture);
        await Promise.all([started, cancelled]);
        expect(probe.snapshot().result.status).toBe("cancelled");
        expect(fixture.cleanup).toHaveBeenCalledOnce();
        expect(unobserve).toHaveBeenCalledOnce();
    });
});

describe("bounded diagnostic reads", () => {
    it("settles cancellation and releases the read deadline even if the native operation never settles", async () => {
        vi.useFakeTimers();
        try {
            const aborter = new AbortController();
            const operation = awaitDatabaseProbeOperation(new Promise(() => {}), aborter.signal);
            const rejected = expect(operation).rejects.toMatchObject({ name: "DatabaseProbeCancelled" });
            aborter.abort();
            await rejected;
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("times out a foreground diagnostic without exposing arbitrary exception names", async () => {
        vi.useFakeTimers();
        try {
            const operation = awaitDatabaseProbeOperation(new Promise(() => {}));
            const rejected = expect(operation).rejects.toMatchObject({ name: "TimeoutError" });
            await vi.advanceTimersByTimeAsync(8000);
            await rejected;
            expect(databaseProbeErrorName({ name: "private-vault/secret-note" })).toBe("OtherError");
            expect(databaseProbeErrorName(new DOMException("private", "InvalidStateError"))).toBe("InvalidStateError");
        } finally {
            vi.useRealTimers();
        }
    });
});
