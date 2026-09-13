import { afterEach, describe, expect, it } from "vitest";
import { fsPromises as fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { NodeFileSystemAdapter } from "./NodeFileSystemAdapter";

describe("NodeFileSystemAdapter", () => {
    const tempDirs: string[] = [];

    async function createVault(files: string[]) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-node-fs-"));
        tempDirs.push(tempDir);
        for (const file of files) {
            await fs.mkdir(path.dirname(path.join(tempDir, file)), { recursive: true });
            await fs.writeFile(path.join(tempDir, file), `content of ${file}`);
        }
        return new NodeFileSystemAdapter(tempDir);
    }

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    });

    it("lists every file even after a single file was refreshed before the first scan", async () => {
        // The daemon replicates before its mirror scan; replication calls refreshFile(), which used to make
        // the cache non-empty and suppress the initial directory scan (#1143), so getFiles() returned a
        // truncated listing and the scan deleted the missing documents from the remote database.
        const adapter = await createVault(["a.md", "folder/b.md", "folder/sub/c.md"]);

        await adapter.refreshFile("folder/b.md");
        const files = (await adapter.getFiles()).map((file) => file.path).sort();

        expect(files).toEqual(["a.md", "folder/b.md", "folder/sub/c.md"]);
    });

    it("lists every file on a cold cache", async () => {
        const adapter = await createVault(["a.md", "folder/b.md"]);

        const files = (await adapter.getFiles()).map((file) => file.path).sort();

        expect(files).toEqual(["a.md", "folder/b.md"]);
    });

    it("does not return a file that was deleted after the scan", async () => {
        const adapter = await createVault(["a.md", "b.md"]);
        await adapter.getFiles();

        await fs.rm(path.join(tempDirs[0], "b.md"));
        await adapter.refreshFile("b.md");
        const files = (await adapter.getFiles()).map((file) => file.path).sort();

        expect(files).toEqual(["a.md"]);
    });
});
