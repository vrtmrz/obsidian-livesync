import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlParam } from "@/deps";

const mocks = vi.hoisted(() => ({
    requestUrl: vi.fn<
        (request: RequestUrlParam) => Promise<{
            status: number;
            headers: Record<string, string>;
            arrayBuffer: ArrayBuffer;
        }>
    >(),
    platform: {
        isMobile: false,
    },
}));

vi.mock("@/deps.ts", () => ({
    Platform: mocks.platform,
    requestUrl: mocks.requestUrl,
}));

vi.mock("@/deps", () => ({
    Platform: mocks.platform,
    requestUrl: mocks.requestUrl,
}));

vi.mock("@/modules/essentialObsidian/APILib/ObsHttpHandler", () => ({
    ObsHttpHandler: class {},
}));

vi.mock("./ObsidianConfirm", () => ({
    ObsidianConfirm: class {},
}));

import { ObsidianAPIService } from "./ObsidianAPIService";
import type { ObsidianServiceContext } from "./ObsidianServiceContext";

function createService(workspace: Record<string, unknown>, isMobile = false): ObsidianAPIService {
    return new ObsidianAPIService({
        app: { workspace, isMobile },
    } as unknown as ObsidianServiceContext);
}

beforeEach(() => {
    mocks.platform.isMobile = false;
    vi.clearAllMocks();
    mocks.requestUrl.mockReset();
    mocks.requestUrl.mockResolvedValue({ status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0) });
});

describe("ObsidianAPIService.showWindowOnRight", () => {
    it("keeps the status view in the right leaf on mobile", async () => {
        mocks.platform.isMobile = true;
        const rightLeaf = {
            setViewState: vi.fn().mockResolvedValue(undefined),
        };
        const workspace = {
            getLeavesOfType: vi.fn(() => []),
            getLeaf: vi.fn(),
            getRightLeaf: vi.fn(() => rightLeaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace, true);

        expect(service.isMobile()).toBe(true);
        await service.showWindowOnRight("p2p-status");

        expect(workspace.getLeavesOfType).toHaveBeenCalledWith("p2p-status");
        expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
        expect(workspace.getLeaf).not.toHaveBeenCalled();
        expect(rightLeaf.setViewState).toHaveBeenCalledWith({
            type: "p2p-status",
            active: false,
        });
        expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
    });
});

describe("ObsidianAPIService.nativeFetch cache control", () => {
    const url = "https://couchdb.example.test/vault/f%3Ametadata";

    function sentHeaders(): Headers {
        expect(mocks.requestUrl).toHaveBeenCalledOnce();
        return new Headers(mocks.requestUrl.mock.calls[0][0].headers);
    }

    it.each(["GET", "HEAD", "get", "head"])("bypasses cached responses for an explicit no-store %s", async (method) => {
        const headers = {
            Authorization: "Basic fixture",
            "Cache-Control": "public, max-age=3600",
            "cAcHe-CoNtRoL": "max-stale",
            Pragma: "cache",
        };

        await createService({}).nativeFetch(url, { method, cache: "no-store", headers });

        expect(sentHeaders().get("cache-control")).toBe("public, no-cache, no-store");
        expect(sentHeaders().get("pragma")).toBe("cache, no-cache");
        expect(sentHeaders().get("authorization")).toBe("Basic fixture");
        expect(headers["Cache-Control"]).toBe("public, max-age=3600");
        expect(mocks.requestUrl.mock.calls[0][0]).toMatchObject({ url, method });
    });

    it("preserves non-conflicting cache directives when enforcing no-store", async () => {
        const headers = {
            "Cache-Control": 'max-age=3600, no-transform, custom="a,b"',
            "cAcHe-CoNtRoL": 'max-stale=30, min-fresh=5, only-if-cached, custom-two="max-age=1, only-if-cached"',
            Pragma: 'legacy="a,b", no-cache',
            "X-Custom-Header": "preserved",
        };
        const originalHeaders = { ...headers };

        await createService({}).nativeFetch(url, { cache: "no-store", headers });

        const sent = mocks.requestUrl.mock.calls[0][0].headers ?? {};
        expect(sent["Cache-Control"]).toBe(
            'no-transform, custom="a,b", custom-two="max-age=1, only-if-cached", no-cache, no-store'
        );
        expect(sent["cAcHe-CoNtRoL"]).toBeUndefined();
        expect(sent.Pragma).toBe('legacy="a,b", no-cache');
        expect(sent["X-Custom-Header"]).toBe("preserved");
        expect(headers).toEqual(originalHeaders);
    });

    it("uses the Request cache mode when the options do not override it", async () => {
        const request = new Request(url, {
            method: "HEAD",
            cache: "no-store",
            headers: { "X-Fixture": "request" },
        });
        const headers = new Headers({ "X-Other": "options" });

        await createService({}).nativeFetch(request, { headers });

        expect(sentHeaders().get("cache-control")).toBe("no-cache, no-store");
        expect(sentHeaders().get("pragma")).toBe("no-cache");
        expect(sentHeaders().get("x-fixture")).toBe("request");
        expect(sentHeaders().get("x-other")).toBe("options");
        expect(headers.has("cache-control")).toBe(false);
        expect(request.headers.has("cache-control")).toBe(false);
    });

    it("lets the options request no-store for an otherwise cacheable Request", async () => {
        await createService({}).nativeFetch(new Request(url, { cache: "force-cache" }), { cache: "no-store" });

        expect(sentHeaders().get("cache-control")).toBe("no-cache, no-store");
    });

    it("lets an explicit default cache mode override a no-store Request", async () => {
        await createService({}).nativeFetch(new Request(url, { cache: "no-store" }), { cache: "default" });

        expect(sentHeaders().has("cache-control")).toBe(false);
        expect(sentHeaders().has("pragma")).toBe(false);
    });

    it.each([undefined, "default", "no-cache", "reload", "force-cache"] as const)(
        "preserves caller headers for cache mode %s",
        async (cache) => {
            const headers = { "Cache-Control": "max-age=60", Pragma: "fixture" };

            await createService({}).nativeFetch(url, { cache, headers });

            expect(mocks.requestUrl.mock.calls[0][0].headers).toEqual(headers);
        }
    );

    it("does not add cache directives to an ordinary request", async () => {
        await createService({}).nativeFetch(url);

        expect(sentHeaders().has("cache-control")).toBe(false);
        expect(sentHeaders().has("pragma")).toBe(false);
    });

    it.each(["POST", "PUT", "DELETE"])("preserves a no-store %s request", async (method) => {
        const headers = { "Cache-Control": "no-transform" };

        await createService({}).nativeFetch(url, { method, cache: "no-store", headers });

        expect(mocks.requestUrl.mock.calls[0][0]).toMatchObject({ url, method, headers });
        expect(sentHeaders().has("pragma")).toBe(false);
    });

    it("uses the effective method from the options", async () => {
        await createService({}).nativeFetch(new Request(url, { cache: "no-store" }), { method: "POST" });

        expect(sentHeaders().has("cache-control")).toBe(false);
        expect(sentHeaders().has("pragma")).toBe(false);
    });
});
