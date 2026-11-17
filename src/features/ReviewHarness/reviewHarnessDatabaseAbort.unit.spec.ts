import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PouchDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser";
import { runReviewHarnessDatabaseAbort } from "./reviewHarnessDatabaseAbort";
import * as fixtureRuntime from "./reviewHarnessDatabaseProbeRuntime";

const token = "13600000-0000-4000-8000-000000000001";
afterEach(() => vi.restoreAllMocks());

describe("transaction-abort diagnostic", () => {
    it("does not create fixtures without confirmation", async () => {
        const createToken = vi.fn(() => token);
        const result = await runReviewHarnessDatabaseAbort({
            factory: indexedDB,
            PouchDB,
            createToken,
            confirmStart: async () => false,
        });
        expect(result.status).toBe("cancelled");
        expect(createToken).not.toHaveBeenCalled();
    });

    it("never reopens an unfinished read and still cleans up both adapter fixtures", async () => {
        const fixture: fixtureRuntime.DatabaseAbortProbeFixture = {
            verifyContents: vi.fn(async () => ({ contentMatches: true, revisionMatches: true })),
            abortRead: vi.fn(async () => ({ injected: true, outcome: "pending" as const, drained: false })),
            check: vi.fn(async () => ({ observations: [], connectionFailure: false })),
            closeNative: vi.fn(),
            reopen: vi.fn(async () => ({ observations: [], connectionFailure: false })),
            cleanup: vi.fn(async () => undefined),
        };
        const createFixture = vi.spyOn(fixtureRuntime, "createDatabaseProbeFixture").mockResolvedValue(fixture);

        const result = await runReviewHarnessDatabaseAbort({
            factory: indexedDB,
            PouchDB,
            createToken: () => token,
            confirmStart: async () => true,
        });

        expect(result.status).toBe("observed");
        expect(createFixture).toHaveBeenCalledTimes(2);
        expect(fixture.reopen).not.toHaveBeenCalled();
        expect(fixture.check).not.toHaveBeenCalled();
        expect(fixture.cleanup).toHaveBeenCalledTimes(2);
        for (const adapter of ["idb", "indexeddb"]) {
            expect(result.observations).toContain(
                `${adapter}.reopen=not-attempted; this diagnostic observes the aborted read`
            );
        }
    });

    it("records unfinished stock-adapter reads and event counts without pretending that they drained", async () => {
        const open = indexedDB.open;
        const result = await runReviewHarnessDatabaseAbort({
            factory: indexedDB,
            PouchDB,
            createToken: () => token,
            confirmStart: async () => true,
        });
        expect(result.status, result.observations.join("\n")).toBe("observed");
        for (const adapter of ["idb", "indexeddb"]) {
            expect(result.observations).toEqual(
                expect.arrayContaining([
                    expect.stringContaining(`${adapter}.abort.injected=true; operation=pending; drain=false`),
                    `${adapter}.reopen=not-attempted; this diagnostic observes the aborted read`,
                    `${adapter}.cleanup=completed`,
                    expect.stringContaining(`${adapter}.fixture-native.abort: listener=registered; received=1`),
                    expect.stringContaining(`${adapter}.fixture-native.versionchange: listener=registered; received=0`),
                ])
            );
        }
        expect(indexedDB.open).toBe(open);
        expect(result.observations.some((line) => line.includes("explicit-reopen-requested"))).toBe(false);
        expect(JSON.stringify(result)).not.toContain(token);
    }, 25000);
});
