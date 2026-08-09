import { HttpRequest } from "@smithy/protocol-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.hoisted(() =>
    vi.fn<
        (param: { body?: string | ArrayBuffer }) => Promise<{
            headers: Record<string, string>;
            status: number;
            arrayBuffer: ArrayBuffer;
        }>
    >()
);

vi.mock("@/deps.ts", () => ({
    requestUrl: requestUrlMock,
}));

import { ObsHttpHandler } from "./ObsHttpHandler.ts";

function requestWithBody(body: unknown) {
    return new HttpRequest({
        protocol: "https:",
        hostname: "objects.example.com",
        method: "PUT",
        path: "/bucket/object",
        headers: {},
        body,
    });
}

describe("ObsHttpHandler request bodies", () => {
    beforeEach(() => {
        requestUrlMock.mockReset();
        requestUrlMock.mockResolvedValue({
            headers: {},
            status: 200,
            arrayBuffer: new ArrayBuffer(0),
        });
    });

    it("sends only the bytes addressed by an ArrayBuffer view", async () => {
        const body = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);

        await new ObsHttpHandler().handle(requestWithBody(body));

        expect(requestUrlMock).toHaveBeenCalledOnce();
        const transmittedBody = requestUrlMock.mock.calls[0][0].body;
        expect(transmittedBody).toBeInstanceOf(ArrayBuffer);
        expect([...new Uint8Array(transmittedBody as ArrayBuffer)]).toEqual([1, 2]);
    });

    it("rejects an unsupported body instead of dispatching an empty request", async () => {
        const body = new ReadableStream<Uint8Array>();

        await expect(new ObsHttpHandler().handle(requestWithBody(body))).rejects.toThrow(
            "Obsidian requestUrl does not support the request body type ReadableStream"
        );
        expect(requestUrlMock).not.toHaveBeenCalled();
    });
});
