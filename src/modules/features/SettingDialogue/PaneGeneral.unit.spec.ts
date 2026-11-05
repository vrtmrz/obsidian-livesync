import { afterEach, describe, expect, it, vi } from "vitest";
import { paneGeneral } from "./PaneGeneral.ts";

const settingHarness = vi.hoisted(() => ({
    rendered: [] as unknown[],
}));

vi.mock("@/common/translation", () => ({
    $msg: (key: string) => key,
    $t: (key: string) => key,
}));

vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class LiveSyncSetting {},
}));

vi.mock("./SettingSpec.ts", async (importOriginal) => {
    const original = await importOriginal<typeof import("./SettingSpec.ts")>();
    return {
        ...original,
        renderLegacySettingSpec: vi.fn((_renderer: unknown, spec: unknown) => {
            settingHarness.rendered.push(spec);
        }),
    };
});

afterEach(() => {
    settingHarness.rendered.length = 0;
    vi.clearAllMocks();
});

describe("paneGeneral", () => {
    it("renders path identity once in the File identity panel and preserves its held value", async () => {
        const addPanel = vi.fn((_parent: HTMLElement, heading: string) =>
            Promise.resolve({ heading } as unknown as HTMLElement)
        );
        const host = {
            isConfiguredAs: vi.fn(() => false),
        };

        paneGeneral.call(host as never, {} as HTMLElement, { addPanel } as never);
        await vi.waitFor(() => expect(settingHarness.rendered).toHaveLength(14));

        expect(addPanel.mock.calls.map(([, heading]) => heading)).toEqual([
            "obsidianLiveSyncSettingTab.titleAppearance",
            "obsidianLiveSyncSettingTab.titleLogging",
            "File identity",
            "obsidianLiveSyncSettingTab.titleExtraMenus",
        ]);
        const pathIdentity = settingHarness.rendered.filter(
            (spec) => (spec as { key: string }).key === "pathNormalizationVersion"
        );
        expect(pathIdentity).toHaveLength(1);
        expect(pathIdentity[0]).toMatchObject({ holdValue: true });
        expect((pathIdentity[0] as { visible?: () => boolean }).visible).toBeUndefined();
    });
});
