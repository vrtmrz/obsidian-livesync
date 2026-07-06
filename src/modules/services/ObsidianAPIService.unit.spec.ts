import { describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/deps", () => {
    return {
        requestUrl: requestUrlMock,
        Notice: vi.fn(),
        Platform: {},
    };
});

vi.mock("@/deps.ts", () => {
    return {
        requestUrl: requestUrlMock,
        Notice: vi.fn(),
        Platform: {},
    };
});

vi.mock("./ObsidianConfirm", () => ({
    ObsidianConfirm: class {},
}));

import { ObsidianAPIService } from "./ObsidianAPIService.ts";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";

describe("ObsidianAPIService.nativeFetch", () => {
    it("should pass binary string-request bodies to requestUrl as ArrayBuffer", async () => {
        requestUrlMock.mockResolvedValueOnce({
            arrayBuffer: new TextEncoder().encode("ok").buffer,
            headers: {},
            status: 207,
        });
        const service = new ObsidianAPIService({} as ObsidianServiceContext);
        const body = new TextEncoder().encode("payload");

        const response = await service.nativeFetch("https://webdav.example.com/file", {
            method: "PUT",
            body: body as unknown as BodyInit,
            headers: {
                Depth: "1",
                Authorization: "Basic dXNlcjpwYXNz",
            },
        });

        expect(response.status).toBe(207);
        expect(requestUrlMock).toHaveBeenCalledWith(
            expect.objectContaining({
                url: "https://webdav.example.com/file",
                method: "PUT",
                body: expect.any(ArrayBuffer),
                headers: expect.objectContaining({
                    Depth: "1",
                    Authorization: "Basic dXNlcjpwYXNz",
                }),
                throw: false,
            })
        );
        const requestBody = requestUrlMock.mock.calls[0][0].body as ArrayBuffer;
        expect(new TextDecoder().decode(requestBody)).toBe("payload");
    });
});
