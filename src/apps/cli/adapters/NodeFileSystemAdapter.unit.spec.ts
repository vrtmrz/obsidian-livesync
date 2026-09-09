import { afterEach, describe, expect, it } from "vitest";
import { fsPromises as fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { NodeFileSystemAdapter } from "./NodeFileSystemAdapter";

describe("NodeFileSystemAdapter.getFiles", () => {
    const tempDirs: string[] = [];

    async function createVault(files: Record<string, string>) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-fs-adapter-"));
        tempDirs.push(tempDir);
        for (const [relativePath, content] of Object.entries(files)) {
            const fullPath = path.join(tempDir, relativePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content, "utf-8");
        }
        return { adapter: new NodeFileSystemAdapter(tempDir), vaultPath: tempDir };
    }

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    });

    it("lists every file on a cold cache", async () => {
        const { adapter } = await createVault({
            "a.md": "a",
            "sub/b.md": "b",
            "sub/deep/c.md": "c",
        });

        const files = await adapter.getFiles();

        expect(files.map((file) => file.path).sort()).toEqual(["a.md", "sub/b.md", "sub/deep/c.md"]);
    });

    it("still performs the initial scan when the cache was warmed by refreshFile", async () => {
        // Reproduces the daemon's startup order: replication materialises a few
        // files (each one going through refreshFile) *before* the mirror scan
        // calls getFiles(). Inferring "already scanned" from a non-empty cache
        // made getFiles() skip scanDirectory() and return only that subset.
        const { adapter } = await createVault({
            "a.md": "a",
            "sub/b.md": "b",
            "sub/deep/c.md": "c",
        });

        await adapter.refreshFile("a.md");

        const files = await adapter.getFiles();

        expect(files.map((file) => file.path).sort()).toEqual(["a.md", "sub/b.md", "sub/deep/c.md"]);
    });

    it("scans only once across repeated calls", async () => {
        const { adapter, vaultPath } = await createVault({ "a.md": "a" });

        await adapter.getFiles();
        // A file appearing without notifying the adapter must not be picked up by
        // a second getFiles(): the cache is authoritative once the scan has run,
        // and incremental updates are the watcher's job.
        await fs.writeFile(path.join(vaultPath, "b.md"), "b", "utf-8");

        const files = await adapter.getFiles();

        expect(files.map((file) => file.path)).toEqual(["a.md"]);
    });
});
