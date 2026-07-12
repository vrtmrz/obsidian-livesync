import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { storageAdapterContractCases } from "@/apps/storageAdapterContract";
import { NodeStorageAdapter } from "./NodeStorageAdapter";

describe("NodeStorageAdapter", () => {
    const tempDirs: string[] = [];

    async function createAdapter() {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-node-storage-"));
        tempDirs.push(tempDir);
        return new NodeStorageAdapter(tempDir);
    }

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    });

    for (const contractCase of storageAdapterContractCases) {
        it(contractCase.name, async () => {
            await contractCase.run(await createAdapter());
        });
    }

    it("writes and reads binary data without corruption", async () => {
        const adapter = await createAdapter();
        const expected = Uint8Array.from([0x00, 0x7f, 0x80, 0xff, 0x42]);

        await adapter.writeBinary("files/blob.bin", expected.buffer.slice(0));
        const result = await adapter.readBinary("files/blob.bin");

        expect(Array.from(new Uint8Array(result))).toEqual(Array.from(expected));
    });

    it("returns an ArrayBuffer with the exact file length", async () => {
        const adapter = await createAdapter();
        const expected = Uint8Array.from([0x10, 0x20, 0x30]);

        await adapter.writeBinary("files/small.bin", expected.buffer.slice(0));
        const result = await adapter.readBinary("files/small.bin");

        expect(result.byteLength).toBe(expected.byteLength);
        expect(Array.from(new Uint8Array(result))).toEqual([0x10, 0x20, 0x30]);
    });

    it.todo("rejects paths that escape the configured root");
    it.todo("rejects removing the configured root through an empty path");
});
