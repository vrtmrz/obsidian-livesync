import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { HttpRequest } from "@smithy/protocol-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.hoisted(() =>
    vi.fn<
        (param: { body?: string | ArrayBuffer; throw?: boolean }) => Promise<{
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

function mockS3ErrorResponse(status: number, code?: string) {
    requestUrlMock.mockImplementation(async (param) => {
        if (param.throw !== false) {
            throw new Error(`Request failed, status ${status}`);
        }
        return {
            headers: { "content-type": "application/xml" },
            status,
            arrayBuffer: new TextEncoder().encode(code ? `<Error><Code>${code}</Code></Error>` : "").buffer,
        };
    });
}

function createS3Client() {
    return new S3Client({
        region: "us-east-1",
        credentials: {
            accessKeyId: "access-key",
            secretAccessKey: "secret-key",
        },
        endpoint: "https://objects.example.com",
        forcePathStyle: true,
        maxAttempts: 1,
        requestHandler: new ObsHttpHandler(),
    });
}

function getMissingObject(client: S3Client) {
    return client.send(
        new GetObjectCommand({
            Bucket: "bucket",
            Key: "missing.json",
        })
    );
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

describe("ObsHttpHandler response handling", () => {
    beforeEach(() => {
        requestUrlMock.mockReset();
    });

    it("returns an HTTP error response to the Smithy client", async () => {
        mockS3ErrorResponse(404, "NoSuchKey");
        const request = new HttpRequest({
            protocol: "https:",
            hostname: "objects.example.com",
            method: "GET",
            path: "/bucket/missing.json",
            headers: {},
        });

        const result = await new ObsHttpHandler().handle(request);

        expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
        expect(result.response.statusCode).toBe(404);
    });

    it.each([
        { code: "NoSuchKey", name: "NoSuchKey" },
        { code: undefined, name: "NotFound" },
    ])("lets the S3 client classify a missing object as $name", async ({ code, name }) => {
        mockS3ErrorResponse(404, code);

        await expect(getMissingObject(createS3Client())).rejects.toMatchObject({
            name,
            $metadata: { httpStatusCode: 404 },
        });
    });

    it.each([
        { status: 403, code: "AccessDenied" },
        { status: 500, code: "InternalError" },
    ])("keeps an S3 $status response distinct from a missing object", async ({ status, code }) => {
        mockS3ErrorResponse(status, code);

        await expect(getMissingObject(createS3Client())).rejects.toMatchObject({
            name: code,
            $metadata: { httpStatusCode: status },
        });
    });

    it("preserves a transport failure", async () => {
        const failure = new Error("network failed");
        requestUrlMock.mockRejectedValue(failure);

        await expect(new ObsHttpHandler().handle(requestWithBody(new ArrayBuffer(0)))).rejects.toBe(failure);
    });
});
