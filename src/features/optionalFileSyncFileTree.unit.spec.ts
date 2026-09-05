import { describe, expect, it, vi } from "vitest";
import { collectOptionalFileSyncFiles } from "./optionalFileSyncFileTree.ts";

describe("collectOptionalFileSyncFiles", () => {
    it("collects files to the requested directory depth", async () => {
        const listings = new Map([
            ["root", { files: ["root/file"], folders: ["root/one"] }],
            ["root/one", { files: ["root/one/file"], folders: ["root/one/two"] }],
            ["root/one/two", { files: ["root/one/two/file"], folders: ["root/one/two/three"] }],
            ["root/one/two/three", { files: ["root/one/two/three/file"], folders: [] }],
        ]);
        const listFiles = vi.fn(async (path: string) => listings.get(path) ?? { files: [], folders: [] });

        await expect(collectOptionalFileSyncFiles({ listFiles }, "root", { maxDepth: 2 })).resolves.toEqual([
            "root/file",
            "root/one/file",
            "root/one/two/file",
        ]);
        expect(listFiles).not.toHaveBeenCalledWith("root/one/two/three");
    });

    it("uses the same asynchronous filter for files and directory traversal", async () => {
        const listFiles = vi.fn(async (path: string) =>
            path == "root"
                ? { files: ["root/include", "root/skip"], folders: ["root/allowed", "root/blocked"] }
                : { files: [`${path}/include`], folders: [] }
        );
        const shouldInclude = vi.fn(async (path: string) => !path.includes("skip") && !path.includes("blocked"));

        await expect(collectOptionalFileSyncFiles({ listFiles }, "root", { shouldInclude })).resolves.toEqual([
            "root/include",
            "root/allowed/include",
        ]);
        expect(listFiles).not.toHaveBeenCalledWith("root/blocked");
    });

    it("reports an unreadable directory and keeps the successful part of the traversal", async () => {
        const failure = new Error("unreadable");
        const listFiles = vi.fn(async (path: string) => {
            if (path == "root/failing") throw failure;
            return { files: ["root/file"], folders: ["root/failing"] };
        });
        const onError = vi.fn();

        await expect(collectOptionalFileSyncFiles({ listFiles }, "root", { onError })).resolves.toEqual(["root/file"]);
        expect(onError).toHaveBeenCalledWith("root/failing", failure);
    });
});
