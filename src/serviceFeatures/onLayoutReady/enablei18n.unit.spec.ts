import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const noticeState = vi.hoisted(() => ({
    instances: [] as Array<{ hide: ReturnType<typeof vi.fn>; duration: number }>,
    spanTexts: [] as string[],
}));

vi.mock("@/deps", () => ({
    getLanguage: () => "ja",
    requireApiVersion: () => true,
    Notice: class {
        hide = vi.fn();

        constructor(_fragment: unknown, duration: number) {
            noticeState.instances.push({ hide: this.hide, duration });
        }
    },
}));

vi.mock("@/common/translation", () => ({
    $msg: (key: string) =>
        ({
            "dialog.yourLanguageAvailable": "Translation has been applied.\n\nMore details.",
            "dialog.yourLanguageAvailable.btnRevertToDefault": "Keep Default",
            "dialog.yourLanguageAvailable.Title": "Translation is available!",
            "Display Language": "Display language",
            "Open the dialog": "Open the dialogue",
        })[key] ?? key,
    __onMissingTranslation: vi.fn(),
    setLang: vi.fn(),
}));

import { enableI18nFeature } from "./enablei18n.ts";

describe("automatic display language", () => {
    let clickDetails: ((event: { preventDefault(): void }) => void) | undefined;

    beforeEach(() => {
        noticeState.instances.length = 0;
        noticeState.spanTexts.length = 0;
        clickDetails = undefined;
        vi.stubGlobal("createFragment", (build: (fragment: unknown) => void) => {
            const anchor = {
                addEventListener: (_event: string, listener: (event: { preventDefault(): void }) => void) => {
                    clickDetails = listener;
                },
                closest: () => ({ classList: { add: vi.fn() } }),
            };
            const fragment = {
                createSpan: ({ text }: { text: string }) => noticeState.spanTexts.push(text),
                createEl: (_tag: string, _options: unknown, configure: (element: typeof anchor) => void) => {
                    configure(anchor);
                    return anchor;
                },
            };
            build(fragment);
            return fragment;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("lets start-up continue and opens translation details only from a persistent Notice", async () => {
        const settings = { displayLanguage: "" };
        const applyPartial = vi.fn(async (partial: Partial<typeof settings>) => Object.assign(settings, partial));
        const saveSettingData = vi.fn().mockResolvedValue(undefined);
        const askSelectStringDialogue = vi.fn().mockResolvedValue("Keep Default");
        const unloadHandlers: Array<() => Promise<boolean>> = [];
        const host = {
            services: {
                setting: {
                    currentSettings: () => settings,
                    applyPartial,
                    saveSettingData,
                },
                API: {
                    addLog: vi.fn(),
                    confirm: { askSelectStringDialogue },
                },
                appLifecycle: {
                    onUnload: {
                        addHandler: (handler: () => Promise<boolean>) => unloadHandlers.push(handler),
                    },
                },
            },
        };

        await expect(enableI18nFeature(host as never)).resolves.toBe(true);

        expect(settings.displayLanguage).toBe("ja");
        expect(saveSettingData).toHaveBeenCalledOnce();
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        expect(noticeState.instances).toHaveLength(1);
        expect(noticeState.instances[0]?.duration).toBe(0);
        expect(noticeState.spanTexts).toEqual(["Translation has been applied. "]);
        expect(clickDetails).toBeTypeOf("function");

        clickDetails?.({ preventDefault: vi.fn() });
        await vi.waitFor(() => expect(askSelectStringDialogue).toHaveBeenCalledOnce());
        expect(askSelectStringDialogue.mock.calls[0]?.[2]).toMatchObject({ title: "Display language" });
        await vi.waitFor(() => expect(settings.displayLanguage).toBe("def"));
        expect(saveSettingData).toHaveBeenCalledTimes(2);

        await expect(unloadHandlers[0]?.()).resolves.toBe(true);
        expect(noticeState.instances[0]?.hide).toHaveBeenCalled();
    });
});
