import { afterEach, describe, expect, it, vi } from "vitest";
import { paneAdvanced } from "./PaneAdvanced.ts";

const settingHarness = vi.hoisted(() => ({
    createdIn: [] as HTMLElement[],
    rendered: [] as unknown[],
}));

vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class LiveSyncSetting {
        constructor(containerEl: HTMLElement) {
            settingHarness.createdIn.push(containerEl);
        }
    },
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
    settingHarness.createdIn.length = 0;
    settingHarness.rendered.length = 0;
    vi.clearAllMocks();
});

describe("paneAdvanced", () => {
    it("renders the shared specifications into the four existing panels", async () => {
        const panelElements = new Map<string, HTMLElement>();
        const addPanel = vi.fn((_parent: HTMLElement, heading: string) => {
            const panel = { heading } as unknown as HTMLElement;
            panelElements.set(heading, panel);
            return Promise.resolve(panel);
        });
        const host = {
            onlyOnCouchDB: vi.fn(() => ({ visibility: false })),
        };

        paneAdvanced.call(host as never, {} as HTMLElement, { addPanel } as never);
        await vi.waitFor(() => expect(settingHarness.rendered).toHaveLength(9));

        expect(addPanel.mock.calls.map(([, heading]) => heading)).toEqual([
            "Memory cache",
            "Local Database Tweak",
            "Transfer Tweak",
            "Remote Database Tweak",
        ]);
        expect(settingHarness.createdIn).toEqual([
            panelElements.get("Memory cache"),
            panelElements.get("Local Database Tweak"),
            panelElements.get("Local Database Tweak"),
            panelElements.get("Transfer Tweak"),
            panelElements.get("Transfer Tweak"),
            panelElements.get("Transfer Tweak"),
            panelElements.get("Transfer Tweak"),
            panelElements.get("Transfer Tweak"),
            panelElements.get("Remote Database Tweak"),
        ]);
        expect(settingHarness.rendered.map((spec) => (spec as { key: string }).key)).toEqual([
            "hashCacheMaxCount",
            "chunkSplitterVersion",
            "customChunkSize",
            "readChunksOnline",
            "useOnlyLocalChunk",
            "concurrencyOfReadChunksOnline",
            "minimumIntervalOfReadChunksOnline",
            "autoAcceptCompatibleTweak",
            "enableCompression",
        ]);

        const readChunksOnline = settingHarness.rendered.find(
            (spec) => (spec as { key: string }).key === "readChunksOnline"
        ) as { visible: () => boolean };
        expect(readChunksOnline.visible()).toBe(false);
        expect(host.onlyOnCouchDB).toHaveBeenCalledOnce();
    });
});
