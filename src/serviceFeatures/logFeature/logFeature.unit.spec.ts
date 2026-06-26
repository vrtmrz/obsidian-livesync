import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Obsidian dependency barrel
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    Notice: class MockNotice {
        setMessage = vi.fn();
        hide = vi.fn();
    },
    normalizePath: (p: string) => p,
    debounce: (fn: any) => fn,
}));

vi.mock("@/modules/features/Log/LogPaneView.ts", () => ({
    VIEW_TYPE_LOG: "livesync-log",
    LogPaneView: class {},
}));

import { createInitialState } from "./state";
import { processAddLog } from "./logOperations";
import type { LogFeatureHost } from "./types";
import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "@lib/common/types";

describe("LogFeature Operations", () => {
    let host: LogFeatureHost;
    const mockAppendHiddenFile = vi.fn();
    const mockIsExists = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        host = {
            services: {
                setting: {
                    settings: {
                        writeLogToTheFile: true,
                        lessInformationInLog: false,
                        showVerboseLog: true,
                    },
                },
                vault: {
                    getVaultName: vi.fn(() => "test-vault"),
                },
            },
            serviceModules: {
                storageAccess: {
                    isExists: mockIsExists,
                    appendHiddenFile: mockAppendHiddenFile,
                },
            },
        } as unknown as LogFeatureHost;
    });

    describe("processAddLog", () => {
        it("adds logs to state.logForDump and state.logForDisplay", () => {
            const state = createInitialState();

            processAddLog(host, state, "Test Message", LOG_LEVEL_INFO);

            expect(state.logForDump.length).toBe(1);
            expect(state.logForDisplay.length).toBe(1);
            expect(state.logForDump[0]).toContain("Test Message");
        });

        it("filters out verbose logs when configured to do so", () => {
            const state = createInitialState();
            host.services.setting.settings.showVerboseLog = false;

            processAddLog(host, state, "Verbose Message", LOG_LEVEL_VERBOSE);

            expect(state.logForDump.length).toBe(1); // Dump has it
            expect(state.logForDisplay.length).toBe(0); // Display filtered out
        });
    });
});
