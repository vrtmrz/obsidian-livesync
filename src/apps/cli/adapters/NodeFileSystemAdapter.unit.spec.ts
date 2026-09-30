import { afterEach, describe, expect, it, vi } from "vitest";
import { fsPromises as fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { NodeFileSystemAdapter } from "./NodeFileSystemAdapter";

describe("NodeFileSystemAdapter file enumeration", () => {
    const tempDirs: string[] = [];
    const paths = ["a.md", "folder/b.md", "folder/sub/c.md"];

    async function createVault() {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-enumeration-"));
        tempDirs.push(directory);
        for (const file of paths) {
            await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
            await fs.writeFile(path.join(directory, file), `content of ${file}`);
        }
        return { directory, adapter: new NodeFileSystemAdapter(directory) };
    }

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
    });

    it("lists every file when one file was refreshed before the first enumeration", async () => {
        const { adapter } = await createVault();

        expect(await adapter.refreshFile("folder/b.md")).not.toBeNull();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
    });

    it("lists every file after a path lookup without any replication", async () => {
        const { adapter } = await createVault();

        expect((await adapter.getAbstractFileByPath("folder/b.md"))?.path).toBe("folder/b.md");

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
    });

    it("lists every file on the first enumeration without a prior path lookup", async () => {
        const { adapter } = await createVault();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
    });

    it("excludes a deleted file after its cache entry is refreshed", async () => {
        const { directory, adapter } = await createVault();
        await adapter.getFiles();

        await fs.rm(path.join(directory, "folder/b.md"));
        expect(await adapter.refreshFile("folder/b.md")).toBeNull();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(["a.md", "folder/sub/c.md"]);
    });

    it("reflects files added and deleted between enumerations", async () => {
        const { directory, adapter } = await createVault();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);

        await fs.rm(path.join(directory, "folder/b.md"));
        const updatedContent = "updated content of a.md";
        await fs.writeFile(path.join(directory, "a.md"), updatedContent);
        await fs.writeFile(path.join(directory, "later.md"), "content of later.md");

        const files = await adapter.getFiles();
        expect(files.map((file) => file.path).sort()).toEqual(["a.md", "folder/sub/c.md", "later.md"]);
        expect(files.find((file) => file.path === "a.md")?.stat.size).toBe(updatedContent.length);
    });

    it("returns complete listings from simultaneous calls", async () => {
        const { adapter } = await createVault();

        const originalStat = adapter.storage.stat.bind(adapter.storage);
        let releaseFolderStat!: () => void;
        const folderStatReleased = new Promise<void>((resolve) => {
            releaseFolderStat = resolve;
        });
        let folderStatStarted!: () => void;
        const folderStatStartedPromise = new Promise<void>((resolve) => {
            folderStatStarted = resolve;
        });
        let pauseFolderStat = true;
        const statSpy = vi.spyOn(adapter.storage, "stat").mockImplementation(async (relativePath) => {
            const stat = await originalStat(relativePath);
            if (pauseFolderStat && relativePath === "folder") {
                pauseFolderStat = false;
                folderStatStarted();
                await folderStatReleased;
            }
            return stat;
        });

        const firstListing = adapter.getFiles();
        let listings: Awaited<ReturnType<typeof adapter.getFiles>>[] | undefined;
        try {
            await folderStatStartedPromise;
            const secondListing = adapter.getFiles();
            const secondFiles = await secondListing;
            releaseFolderStat();
            const firstFiles = await firstListing;
            listings = [secondFiles, firstFiles];
        } finally {
            releaseFolderStat();
            statSpy.mockRestore();
        }

        if (!listings) throw new Error("Expected both concurrent listings to complete");
        expect(listings.map((files) => files.map((file) => file.path).sort())).toEqual([paths, paths]);
    });

    it("returns an empty listing for an empty vault", async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-enumeration-empty-"));
        tempDirs.push(directory);
        const adapter = new NodeFileSystemAdapter(directory);

        await expect(adapter.getFiles()).resolves.toEqual([]);
    });
});
