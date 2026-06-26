import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Obsidian dependency barrel
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    Notice: vi.fn(),
    App: class MockApp {},
    ItemView: class MockItemView {},
}));

const mockEnableMinimalSetup = vi.fn();
vi.mock("@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts", () => {
    return {
        ObsidianLiveSyncSettingTab: class {
            enableMinimalSetup = mockEnableMinimalSetup;
        },
    };
});

import type { SettingDialogueHost } from "./types.ts";
import { openSetting, openSettingWizard } from "./settingOperations.ts";

describe("ObsidianSettingDialogue Operations", () => {
    let host: SettingDialogueHost;
    const mockOpen = vi.fn();
    const mockOpenTabById = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        host = {
            app: {
                setting: {
                    open: mockOpen,
                    openTabById: mockOpenTabById,
                },
            },
        } as unknown as SettingDialogueHost;
    });

    describe("openSetting", () => {
        it("triggers setting.open and setting.openTabById", () => {
            openSetting(host);
            expect(mockOpen).toHaveBeenCalledTimes(1);
            expect(mockOpenTabById).toHaveBeenCalledWith("obsidian-livesync");
        });
    });

    describe("openSettingWizard", () => {
        it("opens setting tab and executes enableMinimalSetup on state.settingTab", async () => {
            const state = {
                settingTab: {
                    enableMinimalSetup: mockEnableMinimalSetup,
                } as any,
            };

            await openSettingWizard(host, state);

            expect(mockOpen).toHaveBeenCalledTimes(1);
            expect(mockOpenTabById).toHaveBeenCalledWith("obsidian-livesync");
            expect(mockEnableMinimalSetup).toHaveBeenCalledTimes(1);
        });
    });
});
