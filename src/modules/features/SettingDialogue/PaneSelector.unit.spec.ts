import { beforeEach, describe, expect, it, vi } from "vitest";

const paneSelectorHarness = vi.hoisted(() => ({
    mounts: [] as { component: unknown; target: unknown; props: Record<string, unknown>; handle: unknown }[],
    unmounted: [] as unknown[],
    settings: [] as { containerEl: HTMLElement; controlEl: unknown }[],
    buttons: [] as { text: string; handler?: () => void | Promise<void> }[],
}));

vi.mock("@/common/translation", () => ({ $msg: (value: string) => value }));
vi.mock("./MultipleRegExpControl.svelte", () => ({ default: { name: "MultipleRegExpControl" } }));
vi.mock("svelte", () => ({
    mount: vi.fn((component: unknown, options: { target: unknown; props: Record<string, unknown> }) => {
        const handle = { id: paneSelectorHarness.mounts.length };
        paneSelectorHarness.mounts.push({ component, target: options.target, props: options.props, handle });
        return handle;
    }),
    unmount: vi.fn((component: unknown) => {
        paneSelectorHarness.unmounted.push(component);
    }),
}));
vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class {
        controlEl: { id: number };
        constructor(containerEl: HTMLElement) {
            this.controlEl = { id: paneSelectorHarness.settings.length };
            paneSelectorHarness.settings.push({ containerEl, controlEl: this.controlEl });
        }
        setName(_name: string) {
            return this;
        }
        setDesc(_description: string) {
            return this;
        }
        autoWireNumeric(_key: string, _options: unknown) {
            return this;
        }
        autoWireToggle(_key: string) {
            return this;
        }
        autoWireTextArea(_key: string, _options: unknown) {
            return this;
        }
        addButton(
            callback: (button: {
                setButtonText: (text: string) => unknown;
                onClick: (handler: () => void | Promise<void>) => unknown;
            }) => void
        ) {
            const button = {
                text: "",
                handler: undefined as (() => void | Promise<void>) | undefined,
                setButtonText(text: string) {
                    this.text = text;
                    return this;
                },
                onClick(handler: () => void | Promise<void>) {
                    this.handler = handler;
                    paneSelectorHarness.buttons.push(this);
                    return this;
                },
            };
            callback(button);
            return this;
        }
    },
}));

import { paneSelector } from "./PaneSelector.ts";

type PatternControlProps = {
    patterns: string[];
    originals: string[];
    apply: (patterns: string[]) => Promise<void>;
};

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function renderSelector() {
    const normalPanel = { id: "normal" } as unknown as HTMLElement;
    const hiddenPanel = { id: "hidden" } as unknown as HTMLElement;
    const addPanel = vi.fn((_parent: HTMLElement, title: string) =>
        Promise.resolve(title === "Normal Files" ? normalPanel : hiddenPanel)
    );
    const disposers: (() => void)[] = [];
    const tab = {
        editingSettings: {
            syncOnlyRegEx: "alpha|[]|beta",
            syncIgnoreRegEx: "skip|[]|also-skip",
            syncInternalFilesTargetPatterns: "target-a,target-b",
            syncInternalFilesIgnorePatterns: "existing,\\/node_modules\\/",
            syncInternalFileOverwritePatterns: "overwrite-a,overwrite-b",
        },
        saveAllDirtySettings: vi.fn(async () => {}),
        requestPageRefresh: vi.fn(),
        lifetimeComponent: { register: (dispose: () => void) => disposers.push(dispose) },
    };

    paneSelector.call(tab as never, {} as HTMLElement, { addPanel } as never);
    await vi.waitFor(() => expect(paneSelectorHarness.mounts).toHaveLength(5));
    return { tab, addPanel, disposers };
}

function controlProps(index: number): PatternControlProps {
    return paneSelectorHarness.mounts[index]!.props as unknown as PatternControlProps;
}

beforeEach(() => {
    paneSelectorHarness.mounts.length = 0;
    paneSelectorHarness.unmounted.length = 0;
    paneSelectorHarness.settings.length = 0;
    paneSelectorHarness.buttons.length = 0;
    vi.clearAllMocks();
});

describe("paneSelector multiple-pattern controls", () => {
    it("keeps all five bindings, independent originals, delimiter choices, save ordering, and owned cleanup", async () => {
        const { tab, addPanel, disposers } = await renderSelector();
        expect(addPanel.mock.calls.map(([, title]) => title)).toEqual(["Normal Files", "Hidden Files"]);
        expect(paneSelectorHarness.mounts.map(({ props }) => (props as PatternControlProps).patterns)).toEqual([
            ["alpha", "beta"],
            ["skip", "also-skip"],
            ["target-a", "target-b"],
            ["existing", "\\/node_modules\\/"],
            ["overwrite-a", "overwrite-b"],
        ]);

        for (let index = 0; index < paneSelectorHarness.mounts.length; index++) {
            const { patterns, originals } = controlProps(index);
            expect(originals).toEqual(patterns);
            expect(originals).not.toBe(patterns);
            patterns.push("edited-current-value");
            expect(originals).not.toContain("edited-current-value");
        }

        const cases = [
            {
                index: 0,
                key: "syncOnlyRegEx",
                patterns: ["new-normal-a", "new-normal-b"],
                value: "new-normal-a|[]|new-normal-b",
            },
            {
                index: 1,
                key: "syncIgnoreRegEx",
                patterns: ["new-skip-a", "new-skip-b"],
                value: "new-skip-a|[]|new-skip-b",
            },
            {
                index: 2,
                key: "syncInternalFilesTargetPatterns",
                patterns: ["new-target-a", "new-target-b"],
                value: "new-target-a,new-target-b",
            },
            {
                index: 3,
                key: "syncInternalFilesIgnorePatterns",
                patterns: ["new-ignore-a", "new-ignore-b"],
                value: "new-ignore-a,new-ignore-b",
            },
            {
                index: 4,
                key: "syncInternalFileOverwritePatterns",
                patterns: ["new-overwrite-a", "new-overwrite-b"],
                value: "new-overwrite-a,new-overwrite-b",
            },
        ] as const;
        const events: string[] = [];
        for (let index = 0; index < cases.length; index++) {
            const item = cases[index]!;
            const pendingSave = deferred();
            events.length = 0;
            tab.saveAllDirtySettings.mockImplementationOnce(async () => {
                events.push(`save:${item.key}`);
                await pendingSave.promise;
                events.push("saved");
            });
            tab.requestPageRefresh.mockImplementationOnce(() => {
                events.push("refresh");
            });

            const applying = controlProps(item.index).apply([...item.patterns]);
            expect(tab.editingSettings[item.key as keyof typeof tab.editingSettings]).toBe(item.value);
            expect(tab.saveAllDirtySettings).toHaveBeenCalledTimes(index + 1);
            expect(events).toEqual([`save:${item.key}`]);
            expect(tab.requestPageRefresh).toHaveBeenCalledTimes(index);

            pendingSave.resolve();
            await applying;
            expect(events).toEqual([`save:${item.key}`, "saved", "refresh"]);
            expect(tab.requestPageRefresh).toHaveBeenCalledTimes(index + 1);
        }

        const failure = new Error("settings save failed");
        tab.saveAllDirtySettings.mockRejectedValueOnce(failure);
        await expect(controlProps(2).apply(["assigned-before-failure"])).rejects.toBe(failure);
        expect(tab.editingSettings.syncInternalFilesTargetPatterns).toBe("assigned-before-failure");
        expect(tab.requestPageRefresh).toHaveBeenCalledTimes(cases.length);

        expect(disposers).toHaveLength(5);
        disposers.forEach((dispose) => dispose());
        expect(paneSelectorHarness.unmounted).toEqual(paneSelectorHarness.mounts.map(({ handle }) => handle));
    });

    it("merges default hidden-file ignores with existing patterns and removes duplicates", async () => {
        const { tab } = await renderSelector();
        const defaultButton = paneSelectorHarness.buttons.find(({ text }) => text === "Default");
        const crossPlatformButton = paneSelectorHarness.buttons.find(({ text }) => text === "Cross-platform");
        expect(defaultButton?.handler).toBeDefined();
        expect(crossPlatformButton?.handler).toBeDefined();

        await defaultButton!.handler!();
        expect(tab.editingSettings.syncInternalFilesIgnorePatterns).toBe(
            "existing,\\/node_modules\\/, \\/\\.git\\/, ^\\.git\\/, \\/obsidian-livesync\\/"
        );
        await crossPlatformButton!.handler!();
        expect(tab.editingSettings.syncInternalFilesIgnorePatterns).toBe(
            "existing,\\/node_modules\\/, \\/\\.git\\/, ^\\.git\\/, \\/obsidian-livesync\\/,\\/workspace$ ,\\/workspace.json$,\\/workspace-mobile.json$"
        );
        expect(tab.saveAllDirtySettings).toHaveBeenCalledTimes(2);
        expect(tab.requestPageRefresh).toHaveBeenCalledTimes(2);
    });
});
