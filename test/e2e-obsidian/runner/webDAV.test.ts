import { describe, expect, it } from "vitest";
import { parseWebDAVObjectKeys, webDAVCollectionUrl } from "./webDAV.ts";

describe("WebDAV E2E helpers", () => {
    it("builds an encoded collection URL below the configured endpoint", () => {
        expect(
            webDAVCollectionUrl({ endpoint: "http://127.0.0.1:8088/dav/" }, "Adaptive Journal/run one/").toString()
        ).toBe("http://127.0.0.1:8088/dav/Adaptive%20Journal/run%20one/");
    });

    it("extracts only flat object keys below the exact collection", () => {
        const collection = new URL("http://127.0.0.1:8088/dav/run/");
        const xml = `<?xml version="1.0"?>
            <d:multistatus xmlns:d="DAV:">
                <d:response><d:href>/dav/run/</d:href></d:response>
                <d:response><d:href>/dav/run/a1~manifest.json</d:href></d:response>
                <d:response><d:href>/dav/run/a1~commit~writer~1.bin</d:href></d:response>
                <d:response><d:href>/dav/run/nested/ignored.bin</d:href></d:response>
                <d:response><d:href>/dav/sibling/ignored.bin</d:href></d:response>
            </d:multistatus>`;
        expect(parseWebDAVObjectKeys(xml, collection)).toEqual(["a1~commit~writer~1.bin", "a1~manifest.json"]);
    });
});
