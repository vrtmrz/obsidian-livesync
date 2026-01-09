import { writeFile } from "../utils/fileapi.vite";
import { DummyFileSourceInisialised, generateBinaryFile, generateFile } from "../utils/dummyfile";
import { describe, expect, it } from "vitest";

describe("Test File Teet", async () => {
    await DummyFileSourceInisialised;

    it("should generate binary file correctly", async () => {
        const size = 5000;
        let generatedSize = 0;
        const chunks: Uint8Array[] = [];
        const generator = generateBinaryFile(size);
        const blob = new Blob([...generator], { type: "application/octet-stream" });
        const buf = await blob.arrayBuffer();
        const hexDump = new Uint8Array(buf)
            //@ts-ignore
            .toHex()
            .match(/.{1,32}/g)
            ?.join("\n");
        const secondDummy = generateBinaryFile(size);
        const secondBlob = new Blob([...secondDummy], { type: "application/octet-stream" });
        const secondBuf = await secondBlob.arrayBuffer();
        const secondHexDump = new Uint8Array(secondBuf)
            //@ts-ignore
            .toHex()
            .match(/.{1,32}/g)
            ?.join("\n");
        if (hexDump !== secondHexDump) {
            throw new Error("Generated binary files do not match");
        }
        expect(hexDump).toBe(secondHexDump);
        // await writeFile("test/testtest/dummyfile.test.bin", buf);
        // await writeFile("test/testtest/dummyfile.test.bin.hexdump.txt", hexDump || "");
    });
    it("should generate text file correctly", async () => {
        const size = 25000;
        let generatedSize = 0;
        let content = "";
        const generator = generateFile(size);
        const out = [...generator];
        // const blob = new Blob(out, { type: "text/plain" });
        content = out.join("");

        const secondDummy = generateFile(size);
        const secondOut = [...secondDummy];
        const secondContent = secondOut.join("");
        if (content !== secondContent) {
            throw new Error("Generated text files do not match");
        }
        expect(content).toBe(secondContent);
        // await writeFile("test/testtest/dummyfile.test.txt", await blob.text());
    });
});
