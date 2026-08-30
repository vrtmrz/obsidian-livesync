import { fsPromises, os, path } from "@vrtmrz/livesync-commonlib/node";
import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { NodeFileSystemAdapter } from "./NodeFileSystemAdapter";
import { NodeVaultAdapter } from "./NodeVaultAdapter";

class FailingDirectoryAdapter extends NodeFileSystemAdapter {
    constructor(
        basePath: string,
        private readonly failingPath: string,
        reportDiagnostic: (message: string, error?: unknown) => void = () => undefined
    ) {
        super(basePath, reportDiagnostic);
    }

    protected override async readDirectory(relativePath: string): Promise<{ files: string[]; folders: string[] }> {
        if (relativePath === this.failingPath) throw new Error(`Injected scan failure: ${relativePath}`);
        return await super.readDirectory(relativePath);
    }
}

class CountingDirectoryAdapter extends NodeFileSystemAdapter {
    rootScans = 0;

    protected override async readDirectory(relativePath: string): Promise<{ files: string[]; folders: string[] }> {
        if (relativePath === "") this.rootScans++;
        return await super.readDirectory(relativePath);
    }
}

describe("NodeVaultAdapter.rename", () => {
    it("changes the directory entry case without changing the content", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-case-rename-"));
        try {
            await fsPromises.writeFile(path.join(directory, "Calculus.md"), "content", "utf8");
            const adapter = new NodeVaultAdapter(directory);
            const file = {
                path: "Calculus.md" as FilePath,
                stat: { ctime: 1, mtime: 2, size: 7, type: "file" as const },
            };

            await adapter.rename(file, "calculus.md");

            expect(await fsPromises.readdir(directory)).toEqual(["calculus.md"]);
            expect(await fsPromises.readFile(path.join(directory, "calculus.md"), "utf8")).toBe("content");
            expect(file.path).toBe("calculus.md");
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
        }
    });

    it("does not move a file through a symbolic link outside the vault root", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-rename-root-"));
        const outsideDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-rename-outside-"));
        try {
            await fsPromises.writeFile(path.join(directory, "source.md"), "content", "utf8");
            await fsPromises.symlink(
                outsideDirectory,
                path.join(directory, "linked"),
                process.platform === "win32" ? "junction" : "dir"
            );
            const adapter = new NodeVaultAdapter(directory);
            const file = {
                path: "source.md" as FilePath,
                stat: { ctime: 1, mtime: 2, size: 7, type: "file" as const },
            };

            await expect(adapter.rename(file, "linked/moved.md")).rejects.toThrow(/symbolic link/i);

            await expect(fsPromises.readFile(path.join(directory, "source.md"), "utf8")).resolves.toBe("content");
            await expect(fsPromises.stat(path.join(outsideDirectory, "moved.md"))).rejects.toMatchObject({
                code: "ENOENT",
            });
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
            await fsPromises.rm(outsideDirectory, { recursive: true, force: true });
        }
    });

    it("does not modify a file through a symbolic link outside the vault root", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-modify-root-"));
        const outsideDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-modify-outside-"));
        try {
            await fsPromises.writeFile(path.join(outsideDirectory, "victim.md"), "before", "utf8");
            await fsPromises.symlink(
                outsideDirectory,
                path.join(directory, "linked"),
                process.platform === "win32" ? "junction" : "dir"
            );
            const adapter = new NodeVaultAdapter(directory);
            const file = {
                path: "linked/victim.md" as FilePath,
                stat: { ctime: 1, mtime: 2, size: 6, type: "file" as const },
            };

            await expect(adapter.modify(file, "after")).rejects.toThrow(/symbolic link/i);

            await expect(fsPromises.readFile(path.join(outsideDirectory, "victim.md"), "utf8")).resolves.toBe("before");
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
            await fsPromises.rm(outsideDirectory, { recursive: true, force: true });
        }
    });
});

describe("NodeFileSystemAdapter path case", () => {
    it("returns the complete vault scan when the cache was pre-populated by one reflected file", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-partial-cache-"));
        try {
            await fsPromises.writeFile(path.join(directory, "reflected.md"), "remote change", "utf8");
            await fsPromises.writeFile(path.join(directory, "existing.md"), "existing content", "utf8");
            const adapter = new NodeFileSystemAdapter(directory);

            // A CouchDB replication can reflect one changed file before the daemon's
            // startup mirror scan, leaving the adapter cache non-empty but incomplete.
            await expect(adapter.getAbstractFileByPath("reflected.md")).resolves.toMatchObject({
                path: "reflected.md",
            });

            expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual([
                "existing.md",
                "reflected.md",
            ]);
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
        }
    });

    it("rejects an incomplete inventory when any subtree scan fails", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-failed-subtree-"));
        const reportDiagnostic = vi.fn();
        try {
            await fsPromises.writeFile(path.join(directory, "visible.md"), "visible", "utf8");
            await fsPromises.mkdir(path.join(directory, "blocked"));
            await fsPromises.writeFile(path.join(directory, "blocked", "hidden.md"), "hidden", "utf8");
            const adapter = new FailingDirectoryAdapter(directory, "blocked", reportDiagnostic);

            await expect(adapter.getFiles()).rejects.toThrow("Injected scan failure: blocked");
            expect(reportDiagnostic).toHaveBeenCalledWith(
                `Error scanning directory ${path.join(directory, "blocked")}:`,
                expect.any(Error)
            );
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
        }
    });

    it("shares one atomic inventory across concurrent getFiles calls", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-concurrent-scan-"));
        try {
            await fsPromises.writeFile(path.join(directory, "a.md"), "a", "utf8");
            await fsPromises.writeFile(path.join(directory, "b.md"), "b", "utf8");
            const adapter = new CountingDirectoryAdapter(directory);

            const [first, second] = await Promise.all([adapter.getFiles(), adapter.getFiles()]);
            const expected = ["a.md", "b.md"];
            expect(first.map((file) => file.path).sort()).toEqual(expected);
            expect(second.map((file) => file.path).sort()).toEqual(expected);
            expect(adapter.rootScans).toBe(1);
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
        }
    });

    it("finds the stored case and refreshes the cache after a case-only rename", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-case-cache-"));
        try {
            await fsPromises.writeFile(path.join(directory, "Calculus.md"), "content", "utf8");
            const adapter = new NodeFileSystemAdapter(directory);

            await expect(adapter.getAbstractFileByPath("calculus.md")).resolves.toBeNull();
            const existingFile = await adapter.getAbstractFileByPathInsensitive("calculus.md");
            expect(existingFile?.path).toBe("Calculus.md");
            if (!existingFile) throw new Error("Expected to find Calculus.md case-insensitively");
            const renamedFile = await adapter.renameFile(existingFile, "calculus.md");

            expect(renamedFile.path).toBe("calculus.md");
            expect((await adapter.getFiles()).map((file) => file.path)).toEqual(["calculus.md"]);
            expect(await fsPromises.readdir(directory)).toEqual(["calculus.md"]);
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
        }
    });

    it("reports directory scan failures through the injected diagnostic callback", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-scan-diagnostic-"));
        const missingDirectory = path.join(directory, "missing");
        const reportDiagnostic = vi.fn();
        try {
            const adapter = new NodeFileSystemAdapter(missingDirectory, reportDiagnostic);

            await expect(adapter.scanDirectory()).rejects.toThrow(`Directory does not exist: ${missingDirectory}`);

            expect(reportDiagnostic).toHaveBeenCalledWith(
                `Error scanning directory ${missingDirectory}:`,
                expect.any(Error)
            );
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
        }
    });

    it("rejects explicit scans outside the vault root", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-scan-root-"));
        try {
            const adapter = new NodeFileSystemAdapter(directory);
            await expect(adapter.scanDirectory("../outside")).rejects.toThrow(/outside|relative|parent|\.\./i);
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
        }
    });

    it("does not discover a file through a symbolic link outside the vault root", async () => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-discovery-root-"));
        const outsideDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-discovery-outside-"));
        try {
            await fsPromises.writeFile(path.join(outsideDirectory, "outside.md"), "content", "utf8");
            await fsPromises.symlink(
                outsideDirectory,
                path.join(directory, "linked"),
                process.platform === "win32" ? "junction" : "dir"
            );
            const adapter = new NodeFileSystemAdapter(directory);

            await expect(adapter.getAbstractFileByPath("linked/outside.md")).resolves.toBeNull();
            await expect(adapter.getFiles()).resolves.toEqual([]);
        } finally {
            await fsPromises.rm(directory, { recursive: true, force: true });
            await fsPromises.rm(outsideDirectory, { recursive: true, force: true });
        }
    });
});
