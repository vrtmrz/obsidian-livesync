import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FilePath } from "@lib/common/types";
import { NodeFileSystemAdapter } from "./NodeFileSystemAdapter";
import { NodeVaultAdapter } from "./NodeVaultAdapter";

describe("NodeVaultAdapter.rename", () => {
    it("changes the directory entry case without changing the content", async () => {
        const directory = await mkdtemp(join(tmpdir(), "livesync-case-rename-"));
        try {
            await writeFile(join(directory, "Calculus.md"), "content", "utf8");
            const adapter = new NodeVaultAdapter(directory);
            const file = {
                path: "Calculus.md" as FilePath,
                stat: { ctime: 1, mtime: 2, size: 7, type: "file" as const },
            };

            await adapter.rename(file, "calculus.md");

            expect(await readdir(directory)).toEqual(["calculus.md"]);
            expect(await readFile(join(directory, "calculus.md"), "utf8")).toBe("content");
            expect(file.path).toBe("calculus.md");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

describe("NodeFileSystemAdapter path case", () => {
    it("finds the stored case and refreshes the cache after a case-only rename", async () => {
        const directory = await mkdtemp(join(tmpdir(), "livesync-case-cache-"));
        try {
            await writeFile(join(directory, "Calculus.md"), "content", "utf8");
            const adapter = new NodeFileSystemAdapter(directory);

            await expect(adapter.getAbstractFileByPath("calculus.md")).resolves.toBeNull();
            const existingFile = await adapter.getAbstractFileByPathInsensitive("calculus.md");
            expect(existingFile?.path).toBe("Calculus.md");
            if (!existingFile) throw new Error("Expected to find Calculus.md case-insensitively");
            const renamedFile = await adapter.renameFile(existingFile, "calculus.md");

            expect(renamedFile.path).toBe("calculus.md");
            expect((await adapter.getFiles()).map((file) => file.path)).toEqual(["calculus.md"]);
            expect(await readdir(directory)).toEqual(["calculus.md"]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
