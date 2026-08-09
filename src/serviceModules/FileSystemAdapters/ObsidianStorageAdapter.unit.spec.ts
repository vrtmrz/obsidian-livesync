import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { ObsidianStorageAdapter } from "./ObsidianStorageAdapter";

describe("ObsidianStorageAdapter", () => {
    it("floors write-option timestamps before calling Obsidian storage methods", async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        const writeBinary = vi.fn().mockResolvedValue(undefined);
        const append = vi.fn().mockResolvedValue(undefined);
        const app = {
            vault: {
                adapter: {
                    write,
                    writeBinary,
                    append,
                },
            },
        } as unknown as App;
        const adapter = new ObsidianStorageAdapter(app);
        const options = { ctime: 1778511180024.462, mtime: 1778511180999.913 };
        const expectedOptions = { ctime: 1778511180024, mtime: 1778511180999 };

        await adapter.write("note.md", "text", options);
        await adapter.writeBinary("image.bin", new ArrayBuffer(0), options);
        await adapter.append("log.md", "text", options);

        expect(write).toHaveBeenCalledWith("note.md", "text", expectedOptions);
        expect(writeBinary).toHaveBeenCalledWith("image.bin", expect.any(ArrayBuffer), expectedOptions);
        expect(append).toHaveBeenCalledWith("log.md", "text", expectedOptions);
        expect(options).toEqual({ ctime: 1778511180024.462, mtime: 1778511180999.913 });
    });
});
