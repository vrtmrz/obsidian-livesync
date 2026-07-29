import { fsPromises, os, path } from "@vrtmrz/livesync-commonlib/node";
import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { NodeFileSystemAdapter } from "./NodeFileSystemAdapter";
import { NodeVaultAdapter } from "./NodeVaultAdapter";

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

            await adapter.scanDirectory();

            expect(reportDiagnostic).toHaveBeenCalledWith(
                `Error scanning directory ${missingDirectory}:`,
                expect.any(Error)
            );
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
