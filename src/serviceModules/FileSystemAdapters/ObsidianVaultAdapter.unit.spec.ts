import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { ObsidianVaultAdapter } from "./ObsidianVaultAdapter";

describe("ObsidianVaultAdapter", () => {
    it("preserves a UTF-8 BOM so the content size matches the file stat", async () => {
        const path = "Transcripts/字幕.md";
        const contentWithoutBom = "字幕の検証行です。\n";
        const contentWithBom = `\ufeff${contentWithoutBom}`;
        const read = vi.fn().mockResolvedValue(contentWithoutBom);
        const adapterRead = vi.fn().mockResolvedValue(contentWithBom);
        const app = {
            vault: {
                read,
                adapter: {
                    read: adapterRead,
                },
            },
        } as unknown as App;
        const file = {
            path,
            stat: {
                ctime: 1,
                mtime: 2,
                size: new Blob([contentWithBom]).size,
            },
        } as TFile;
        const adapter = new ObsidianVaultAdapter(app);

        const result = await adapter.read(file);

        expect(new Blob([result]).size).toBe(file.stat.size);
        expect(result.charCodeAt(0)).toBe(0xfeff);
        expect(adapterRead).toHaveBeenCalledWith(path);
        expect(read).not.toHaveBeenCalled();
    });

    it("floors write-option timestamps before calling Obsidian vault methods", async () => {
        const modify = vi.fn().mockResolvedValue(undefined);
        const modifyBinary = vi.fn().mockResolvedValue(undefined);
        const create = vi.fn().mockResolvedValue({});
        const createBinary = vi.fn().mockResolvedValue({});
        const app = {
            vault: {
                modify,
                modifyBinary,
                create,
                createBinary,
            },
        } as unknown as App;
        const file = { path: "note.md" } as TFile;
        const adapter = new ObsidianVaultAdapter(app);
        const options = { ctime: 1778511180024.462, mtime: 1778511180999.913 };
        const expectedOptions = { ctime: 1778511180024, mtime: 1778511180999 };

        await adapter.modify(file, "text", options);
        await adapter.modifyBinary(file, new ArrayBuffer(0), options);
        await adapter.create("created.md", "text", options);
        await adapter.createBinary("created.bin", new ArrayBuffer(0), options);

        expect(modify).toHaveBeenCalledWith(file, "text", expectedOptions);
        expect(modifyBinary).toHaveBeenCalledWith(file, expect.any(ArrayBuffer), expectedOptions);
        expect(create).toHaveBeenCalledWith("created.md", "text", expectedOptions);
        expect(createBinary).toHaveBeenCalledWith("created.bin", expect.any(ArrayBuffer), expectedOptions);
        expect(options).toEqual({ ctime: 1778511180024.462, mtime: 1778511180999.913 });
    });
});
