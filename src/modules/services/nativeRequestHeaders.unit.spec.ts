import { describe, expect, it } from "vitest";
import { createNativeRequestHeaders, shouldRevalidateNativeRequest } from "./nativeRequestHeaders";

describe("native cache revalidation decision", () => {
    it.each(["GET", "HEAD", "get", "head"])("revalidates explicit no-cache/no-store for %s", (method) => {
        expect(shouldRevalidateNativeRequest(method, "no-cache")).toBe(true);
        expect(shouldRevalidateNativeRequest(method, "no-store")).toBe(true);
    });

    it.each([undefined, "default", "reload", "force-cache", "only-if-cached"] as const)(
        "does not strengthen cache mode %s",
        (mode) => {
            expect(shouldRevalidateNativeRequest("GET", mode)).toBe(false);
            expect(shouldRevalidateNativeRequest("HEAD", mode)).toBe(false);
        }
    );

    it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("does not revalidate %s", (method) => {
        expect(shouldRevalidateNativeRequest(method, "no-cache")).toBe(false);
        expect(shouldRevalidateNativeRequest(method, "no-store")).toBe(false);
    });
});

describe("native request header creation", () => {
    it("copies input headers and removes the existing native-controlled header forms", () => {
        const input = Object.freeze({
            host: "first.test",
            Host: "second.test",
            "content-length": "1",
            "Content-Length": "2",
            Authorization: "Bearer fixture",
            "Cache-Control": "max-age=60",
        });
        const result = createNativeRequestHeaders(input, "GET", "default");
        expect(result).toEqual({ Authorization: "Bearer fixture", "Cache-Control": "max-age=60" });
        expect(result).not.toBe(input);
        expect(input.host).toBe("first.test");
        expect(input["Content-Length"]).toBe("2");
    });

    it.each(["GET", "HEAD"])("creates no-store revalidation headers for %s", (method) => {
        expect(createNativeRequestHeaders({}, method, "no-store")).toEqual({
            "cache-control": "no-cache, no-store",
            pragma: "no-cache",
        });
    });

    it("preserves an existing no-store directive when enforcing no-cache", () => {
        expect(
            createNativeRequestHeaders(
                { "Cache-Control": "no-store, max-age=3600", Pragma: "legacy" },
                "GET",
                "no-cache"
            )
        ).toEqual({ "Cache-Control": "no-store, no-cache", Pragma: "legacy, no-cache" });
    });

    it("combines differently cased header fields and retains non-conflicting directives", () => {
        const input = Object.freeze({
            "Cache-Control": 'Max-Age=99, no-transform, custom="a,b", No-Cache',
            "cache-control": "max-stale=5, min-fresh=6, only-if-cached, NO-STORE, private",
            Pragma: 'legacy="a,b", No-Cache',
            pragma: "extension, no-cache",
        });
        expect(createNativeRequestHeaders(input, "get", "no-store")).toEqual({
            "Cache-Control": 'no-transform, custom="a,b", private, no-cache, no-store',
            Pragma: 'legacy="a,b", extension, no-cache',
        });
        expect(input["cache-control"]).toContain("max-stale=5");
    });

    it("does not split directive commas inside escaped quoted strings", () => {
        const custom = String.raw`custom="a\"b,c"`;
        expect(createNativeRequestHeaders({ "cache-control": `${custom}, max-age=1` }, "HEAD", "no-cache")).toEqual({
            "cache-control": `${custom}, no-cache`,
            pragma: "no-cache",
        });
    });

    it.each([
        ["", "no-cache"],
        [", ,  ,", "no-cache"],
        [" , no-transform , ,  ", "no-transform, no-cache"],
    ])("ignores empty header-list members in %j", (value, expected) => {
        const headers = Object.freeze({ "Cache-Control": value, Pragma: " , , " });

        expect(createNativeRequestHeaders(headers, "GET", "no-cache")).toEqual({
            "Cache-Control": expected,
            Pragma: "no-cache",
        });
        expect(headers["Cache-Control"]).toBe(value);
    });

    it("retains cache headers on a non-revalidated method", () => {
        const headers = { "cache-control": "max-age=99", Pragma: "legacy" };
        expect(createNativeRequestHeaders(headers, "POST", "no-store")).toEqual(headers);
    });
});
