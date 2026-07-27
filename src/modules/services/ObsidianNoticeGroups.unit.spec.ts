import { describe, expect, it, vi } from "vitest";

vi.mock("@vrtmrz/obsidian-plugin-kit/notice", () => ({
    KeyedNoticeGroupManager: class KeyedNoticeGroupManager {},
}));

import { ObsidianNoticeGroupManager } from "./ObsidianNoticeGroups";

describe("ObsidianNoticeGroupManager", () => {
    it("keeps Fancy Kit rendering behind the Context-owned capability", () => {
        const driver = {
            setItem: vi.fn(),
            finish: vi.fn(() => true),
            removeItem: vi.fn(() => true),
            hide: vi.fn(() => true),
            dispose: vi.fn(),
        };
        const groups = new ObsidianNoticeGroupManager(driver);
        const item = {
            message: "Complete",
            action: { label: "Review", onSelect: vi.fn() },
        };

        groups.setItem("integrity", "result", item);
        expect(driver.setItem).toHaveBeenCalledWith("integrity", "result", item);
        expect(groups.finish("integrity", { durationMs: 1_000 })).toBe(true);
        expect(groups.removeItem("integrity", "result")).toBe(true);
        expect(groups.hide("integrity")).toBe(true);
        groups.dispose();
        expect(driver.dispose).toHaveBeenCalledOnce();
    });
});
