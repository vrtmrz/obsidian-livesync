import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Obsidian dependency barrel
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    Notice: vi.fn(),
    App: class MockApp {},
    ItemView: class MockItemView {},
}));

vi.mock("@/modules/features/GlobalHistory/GlobalHistoryView.ts", () => {
    return {
        VIEW_TYPE_GLOBAL_HISTORY: "livesync-global-history",
        GlobalHistoryView: class {},
    };
});

import type { GlobalHistoryHost } from "./types.ts";
import { showGlobalHistory } from "./historyOperations.ts";

describe("GlobalHistory Operations", () => {
    let host: GlobalHistoryHost;
    const mockShowWindow = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        host = {
            services: {
                API: {
                    showWindow: mockShowWindow,
                },
            },
        } as unknown as GlobalHistoryHost;
    });

    describe("showGlobalHistory", () => {
        it("triggers API.showWindow with the correct view type", () => {
            showGlobalHistory(host);
            expect(mockShowWindow).toHaveBeenCalledWith("livesync-global-history");
        });
    });
});
