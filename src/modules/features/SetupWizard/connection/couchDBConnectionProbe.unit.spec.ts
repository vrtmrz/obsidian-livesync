import { describe, expect, it, vi } from "vitest";
import { isValidCouchDBServerURL, probeCouchDBConnection } from "./couchDBConnectionProbe";

describe("CouchDB setup connection policy", () => {
    it.each([
        [false, "connect to an existing database"],
        [true, "create or connect to a database"],
    ] as const)("%s can %s through an owned connection probe", async (createIfMissing, _description) => {
        const check = vi.fn(async () => ({ ok: true as const }));
        const dispose = vi.fn(async () => undefined);
        const probe = { check, getStatus: vi.fn(), dispose };

        await expect(probeCouchDBConnection(probe, createIfMissing)).resolves.toEqual({ ok: true });

        expect(check).toHaveBeenCalledWith({ createIfMissing, showResult: false });
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("returns a connection error and still disposes the probe", async () => {
        const dispose = vi.fn(async () => undefined);
        const probe = {
            check: vi.fn(async () => ({ ok: false as const, reason: "database does not exist" })),
            getStatus: vi.fn(),
            dispose,
        };

        await expect(probeCouchDBConnection(probe, false)).resolves.toEqual({
            ok: false,
            reason: "database does not exist",
        });
        expect(dispose).toHaveBeenCalledOnce();
    });

    it.each([
        ["https://couch.example", true],
        ["http://127.0.0.1:5984", true],
        ["ftp://couch.example", false],
        ["couch.example", false],
        ["https://", false],
    ])("validates the saved server URL %s", (value, expected) => {
        expect(isValidCouchDBServerURL(value)).toBe(expected);
    });
});
