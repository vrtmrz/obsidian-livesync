import { describe, expect, it, vi } from "vitest";
import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { InjectableConflictService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableConflictService";
import { LOG_LEVEL_VERBOSE, type FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createConflictCheckingHandlers } from "./checker";

PouchDB.plugin(MemoryAdapter);

type Probe = { completed: number };

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

describe("conflict-check shutdown with a real PouchDB handle", () => {
    it.each([false, true])(
        "reports cancellation and preserves the database outcome when closed before completion: %s",
        async (closeDuringShutdown) => {
            const name = `conflict-shutdown-${crypto.randomUUID()}`;
            const db = new PouchDB<Probe>(name, { adapter: "memory" });
            const started = deferred();
            const release = deferred();
            const conflict = new InjectableConflictService(createServiceContext());
            const lifetime = new AbortController();
            const log = vi.fn();
            const resolver = vi.fn(async () => {
                started.resolve();
                await release.promise;
                const probe = await db.get("_local/shutdown-probe");
                await db.put({ ...probe, completed: probe.completed + 1 });
            });
            conflict.resolve.setHandler(resolver);
            const checking = createConflictCheckingHandlers({
                conflict,
                signal: lifetime.signal,
                conflictProcessQueueCount: conflict.conflictProcessQueueCount,
                cancelActiveResolution: vi.fn(),
                currentSettings: () => ({ checkConflictOnlyOnOpen: false }),
                vault: { getActiveFilePath: () => undefined },
                log,
            });
            conflict.queueCheckFor.setHandler(checking.queueCheckFor);
            let closed = false;
            let reopened: PouchDB.Database<Probe> | undefined;
            let completion: Promise<boolean> | undefined;
            try {
                await db.put({ _id: "_local/shutdown-probe", completed: 0 });
                await checking.queueCheckFor("active.md" as FilePathWithPrefix);
                await started.promise;
                completion = checking.ensureAllProcessed();
                lifetime.abort();
                lifetime.abort();
                await checking.queueCheckFor("late.md" as FilePathWithPrefix);
                if (closeDuringShutdown) {
                    await db.close();
                    closed = true;
                }
                release.resolve();

                await expect(completion).resolves.toBe(false);
                expect(resolver).toHaveBeenCalledOnce();
                if (closeDuringShutdown) {
                    expect(log).toHaveBeenCalledWith(
                        expect.objectContaining({ message: expect.stringMatching(/closed/i) }),
                        LOG_LEVEL_VERBOSE
                    );
                } else {
                    expect(log).not.toHaveBeenCalled();
                    await db.close();
                    closed = true;
                }
                reopened = new PouchDB<Probe>(name, { adapter: "memory" });
                const persisted = await reopened.get("_local/shutdown-probe");
                expect(persisted.completed).toBe(closeDuringShutdown ? 0 : 1);
            } finally {
                release.resolve();
                await completion?.catch(() => undefined);
                if (!closed) await db.close();
                await (reopened ?? new PouchDB<Probe>(name, { adapter: "memory" })).destroy();
            }
        }
    );
});
