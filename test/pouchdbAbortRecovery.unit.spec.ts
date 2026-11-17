/**
 * @file pouchdbAbortRecovery.unit.spec.ts
 * @description The local database survives a transaction aborted underneath it.
 * iOS (WebKit) aborts IndexedDB transactions that are in progress when the app is suspended. With the
 * unpatched adapters, the idb adapter then closed its connection for good (every later call threw
 * "The database connection is closing" until Obsidian was restarted), and with both adapters the
 * operation that was in flight never called back. See patches/pouchdb-adapter-*.patch.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
// the PouchDB build the plugin itself runs, with both local adapters registered
import { PouchDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser";

const HUNG = "no answer within 2 s";
const settled = <T>(p: Promise<T>) =>
    Promise.race([
        p.then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error })
        ),
        new Promise<{ ok: false; error: string }>((resolve) =>
            setTimeout(() => resolve({ ok: false, error: HUNG }), 2000)
        ),
    ]);

const proto = IDBObjectStore.prototype;
const originalGet = proto.get;

/** Abort the transaction of the next object-store read, as WebKit does on suspend. */
function abortNextRead() {
    proto.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["get"]>) {
        const request = originalGet.apply(this, args);
        proto.get = originalGet;
        this.transaction.abort();
        return request;
    };
}

afterEach(() => {
    proto.get = originalGet;
});

describe.each(["idb", "indexeddb"])("local database (%s adapter) after an aborted transaction", (adapter) => {
    it("settles the operation that was in flight, then keeps working without a restart", async () => {
        const db = new PouchDB<{ v: number }>(`abort-recovery-${adapter}-${Date.now()}`, { adapter });
        await db.put({ _id: "a", v: 1 });

        abortNextRead();
        const inFlight = await settled(db.get("a"));
        expect(inFlight.ok, "the aborted read must fail, not hang").toBe(false);
        expect(inFlight.ok ? undefined : inFlight.error).not.toBe(HUNG);

        const read = await settled(db.get("a"));
        expect(read).toMatchObject({ ok: true, value: { v: 1 } });
        const write = await settled(db.put({ _id: "b", v: 2 }));
        expect(write).toMatchObject({ ok: true });
        const info = await settled(db.info());
        expect(info).toMatchObject({ ok: true, value: { doc_count: 2 } });

        await db.destroy();
    });
});
