import { describe, it, expect, vi } from "vitest";

// Mock the Obsidian dependency barrel
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    Notice: vi.fn(),
    App: class MockApp {},
    ItemView: class MockItemView {},
    normalizePath: (p: string) => p,
}));

vi.mock("@/modules/extras/devUtil/TestPaneView.ts", () => ({
    VIEW_TYPE_TEST: "ols-pane-test",
    TestPaneView: class {},
}));

import { createInitialState } from "./state";
import { addTestResult } from "./devOperations";
import { get } from "svelte/store";

describe("DevFeature Operations", () => {
    describe("addTestResult", () => {
        it("appends test results to the writable store in state", () => {
            const state = createInitialState();

            addTestResult(state, "MyTest", "test-1", true, "All passed", "details");

            const results = get(state.testResults);
            expect(results.length).toBe(1);
            expect(results[0]).toEqual([true, "MyTest: test-1 All passed", "details"]);
        });
    });
});
