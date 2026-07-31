import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { ObsidianVaultAdapter } from "./ObsidianVaultAdapter";

describe("ObsidianVaultAdapter.read", () => {
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
});
