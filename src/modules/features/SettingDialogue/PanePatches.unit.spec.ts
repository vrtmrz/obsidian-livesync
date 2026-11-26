import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createLiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { promptText } from "@vrtmrz/obsidian-plugin-kit";
import { EVENT_PLUGIN_UNLOADED } from "@/common/events";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { panePatches } from "./PanePatches.ts";

const paneHarness = vi.hoisted(() => {
    const dateElement = { textContent: "" };
    const createSpan = vi.fn((options?: { text: string }) => {
        dateElement.textContent = options?.text ?? "";
        return dateElement;
    });
    const inputEl = {
        type: "",
    };
    class TextComponent {
        inputEl = inputEl;
        onChange = vi.fn();
        setValue = vi.fn();
    }
    const setButtonClassState = vi.fn();
    const setSettingClassState = vi.fn();
    const logger = vi.fn();
    class ButtonComponent {
        buttonEl = { classList: { toggle: setButtonClassState } };
        setButtonText = vi.fn(() => this);
        setDisabled = vi.fn(() => this);
        onClick = vi.fn((_callback: () => void | Promise<void>) => this);
    }

    return {
        button: new ButtonComponent(),
        ButtonComponent,
        createSpan,
        dateElement,
        inputEl,
        logger,
        setButtonClassState,
        setSettingClassState,
        TextComponent,
        textComponent: new TextComponent(),
    };
});

vi.mock("@/deps.ts", () => ({
    PluginSettingTab: class {},
    TextComponent: paneHarness.TextComponent,
    ButtonComponent: paneHarness.ButtonComponent,
    Setting: class Setting {
        settingEl = {
            classList: {
                toggle: paneHarness.setSettingClassState,
            },
            toggleClass: vi.fn(),
        };
        controlEl = {
            createSpan: paneHarness.createSpan,
            toggleClass: vi.fn(),
        };
        nameEl = { toggleClass: vi.fn() };
        setName = vi.fn();
        setDesc = vi.fn();
        setTooltip = vi.fn();

        addText(callback: (text: typeof paneHarness.textComponent) => void): this {
            callback(paneHarness.textComponent);
            return this;
        }

        addButton(callback: (button: typeof paneHarness.button) => void): this {
            callback(paneHarness.button);
            return this;
        }

        addToggle(): this {
            return this;
        }

        addDropdown(): this {
            return this;
        }
    },
}));

vi.mock("@/common/translation", () => ({
    $msg: (message: string) => message,
    translateLiveSyncMessage: (message: string) => message,
}));
vi.mock("@vrtmrz/obsidian-plugin-kit", () => ({ promptText: vi.fn() }));
vi.mock("@/main.ts", () => ({ default: class {} }));
vi.mock("@/modules/features/SetupManager.ts", () => ({ SetupManager: class {} }));
vi.mock("./SettingsPageCatalogue.ts", () => ({}));

vi.mock("@vrtmrz/livesync-commonlib/compat/common/logger", () => ({
    Logger: paneHarness.logger,
}));

afterEach(() => {
    Reflect.deleteProperty(globalThis, "activeDocument");
    vi.clearAllMocks();
    vi.mocked(promptText).mockReset();
    paneHarness.dateElement.textContent = "";
    paneHarness.inputEl.type = "";
});

function createSettingsTab(suffix = "old") {
    const settings = { ...DEFAULT_SETTINGS, additionalSuffixOfDatabaseName: suffix };
    const events = createLiveSyncEventHub();
    const saveSettingData = vi.fn(async () => undefined);
    const initialiseDatabase = vi.fn(async () => false);
    const performRestart = vi.fn();
    const plugin = {
        app: {},
        core: {
            settings,
            services: {
                context: { events },
                setting: { saveSettingData, getDeviceAndVaultName: () => "", syncGuardSettings: {} },
                appLifecycle: { performRestart },
                databaseEvents: { initialiseDatabase },
            },
        },
    };
    const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
    vi.spyOn(tab, "requestUpdate").mockImplementation(() => undefined);
    return { tab, settings, saveSettingData, initialiseDatabase, performRestart, events };
}

function renderPanel(tab: ObsidianLiveSyncSettingTab, panel: string) {
    const addPanel = vi.fn((_paneEl: HTMLElement, title: string) => ({
        then(callback: (paneEl: HTMLElement) => void) {
            if (title === panel) callback({} as HTMLElement);
        },
    }));
    panePatches.call(tab, {} as HTMLElement, { addPanel } as never);
}

function renderSuffixControl(tab: ObsidianLiveSyncSettingTab) {
    renderPanel(tab, "Edge case addressing (Database)");
    const click = paneHarness.button.onClick.mock.lastCall?.[0];
    if (!click) throw new Error("Missing database suffix control");
    return click;
}

describe("panePatches", () => {
    it("creates the status element in the setting control instead of the document", () => {
        const hierarchyError = new DOMException(
            "Failed to execute 'appendChild' on 'Node': Only one element on document allowed.",
            "HierarchyRequestError"
        );
        const createSpan = vi.fn(() => {
            throw hierarchyError;
        });
        Object.defineProperty(globalThis, "activeDocument", {
            configurable: true,
            value: { createSpan },
        });

        const { tab } = createSettingsTab();
        tab.editingSettings.maxMTimeForReflectEvents = 0;
        renderPanel(tab, "Remediation");
        expect(createSpan).not.toHaveBeenCalled();
        expect(paneHarness.createSpan).toHaveBeenCalledOnce();
        expect(paneHarness.dateElement.textContent).toBe("No limit configured");
        expect(paneHarness.setSettingClassState).toHaveBeenCalledWith("sls-setting-with-additional-actions", true);
        expect(paneHarness.setButtonClassState).toHaveBeenCalledWith("sls-setting-additional-action", true);
    });

    it("displays the saved suffix and saves a confirmed replacement before requesting one restart", async () => {
        const { tab, settings, saveSettingData, initialiseDatabase, performRestart } = createSettingsTab();
        const click = renderSuffixControl(tab);
        const prompt = promiseWithResolvers<string | null>();
        const save = promiseWithResolvers<undefined>();
        vi.mocked(promptText).mockReturnValueOnce(prompt.promise);
        saveSettingData.mockImplementationOnce(async () => {
            expect(settings.additionalSuffixOfDatabaseName).toBe("new");
            return await save.promise;
        });

        const confirmation = click();
        await click();
        expect(paneHarness.dateElement.textContent).toBe("old");
        expect(paneHarness.button.setButtonText).toHaveBeenCalledWith("Configure");
        expect(paneHarness.textComponent.onChange).not.toHaveBeenCalled();
        expect(promptText).toHaveBeenCalledExactlyOnceWith(
            tab.plugin.app,
            expect.objectContaining({ initialValue: "old", submitLabel: "Apply and restart", cancelLabel: "Cancel" }),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(performRestart).not.toHaveBeenCalled();

        prompt.resolve("new");
        await vi.waitFor(() => expect(saveSettingData).toHaveBeenCalledOnce());
        await click();
        expect(promptText).toHaveBeenCalledOnce();
        expect(performRestart).not.toHaveBeenCalled();
        save.resolve(undefined);
        await confirmation;

        expect(initialiseDatabase).not.toHaveBeenCalled();
        expect(performRestart).toHaveBeenCalledOnce();
    });

    it.each(["applyAllSettings", "saveAllDirtySettings"] as const)(
        "keeps the open suffix prompt out of %s",
        async (method) => {
            const { tab, settings, initialiseDatabase, performRestart, saveSettingData } = createSettingsTab();
            const click = renderSuffixControl(tab);
            const prompt = promiseWithResolvers<string | null>();
            vi.mocked(promptText).mockReturnValueOnce(prompt.promise);
            const confirmation = click();
            const showVerboseLog = !settings.showVerboseLog;
            tab.editingSettings.showVerboseLog = showVerboseLog;

            await tab[method]();

            expect(settings.showVerboseLog).toBe(showVerboseLog);
            expect(settings.additionalSuffixOfDatabaseName).toBe("old");
            expect(initialiseDatabase).not.toHaveBeenCalled();
            expect(performRestart).not.toHaveBeenCalled();
            saveSettingData.mockClear();

            prompt.resolve("new");
            await confirmation;
            expect(saveSettingData).toHaveBeenCalledOnce();
            expect(settings.additionalSuffixOfDatabaseName).toBe("new");
            expect(performRestart).toHaveBeenCalledOnce();
        }
    );

    it.each([null, "old"])("leaves the suffix unchanged when the prompt returns %j", async (result) => {
        const { tab, settings, saveSettingData, initialiseDatabase, performRestart } = createSettingsTab();
        const click = renderSuffixControl(tab);
        vi.mocked(promptText).mockResolvedValueOnce(result);

        await click();

        expect(promptText).toHaveBeenCalledOnce();
        expect(settings.additionalSuffixOfDatabaseName).toBe("old");
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(initialiseDatabase).not.toHaveBeenCalled();
        expect(performRestart).not.toHaveBeenCalled();
        expect(paneHarness.button.setDisabled).toHaveBeenLastCalledWith(false);
    });

    it("persists an explicitly empty suffix and displays that empty value", async () => {
        const { tab, settings, saveSettingData, initialiseDatabase, performRestart } = createSettingsTab();
        const click = renderSuffixControl(tab);
        vi.mocked(promptText).mockResolvedValueOnce("");

        await click();

        expect(settings.additionalSuffixOfDatabaseName).toBe("");
        expect(saveSettingData).toHaveBeenCalledOnce();
        expect(initialiseDatabase).not.toHaveBeenCalled();
        expect(performRestart).toHaveBeenCalledOnce();

        const { tab: restartedTab } = createSettingsTab("");
        renderSuffixControl(restartedTab);
        expect(paneHarness.dateElement.textContent).toBe('""');
    });

    it("keeps the previous suffix active and lets the user retry a failed save", async () => {
        const { tab, settings, saveSettingData, initialiseDatabase, performRestart } = createSettingsTab();
        const click = renderSuffixControl(tab);
        saveSettingData.mockRejectedValueOnce(new Error("settings could not be saved"));
        vi.mocked(promptText).mockResolvedValueOnce("new").mockResolvedValueOnce("new");

        await expect(click()).resolves.toBeUndefined();

        expect(settings.additionalSuffixOfDatabaseName).toBe("old");
        expect(paneHarness.dateElement.textContent).toBe("old");
        expect(saveSettingData).toHaveBeenCalledOnce();
        expect(initialiseDatabase).not.toHaveBeenCalled();
        expect(performRestart).not.toHaveBeenCalled();
        expect(paneHarness.logger).toHaveBeenCalledWith(expect.stringContaining("try again"), LOG_LEVEL_NOTICE);
        expect(paneHarness.button.setDisabled).toHaveBeenLastCalledWith(false);

        await click();

        expect(settings.additionalSuffixOfDatabaseName).toBe("new");
        expect(saveSettingData).toHaveBeenCalledTimes(2);
        expect(promptText).toHaveBeenLastCalledWith(
            tab.plugin.app,
            expect.objectContaining({ initialValue: "new" }),
            expect.anything()
        );
        expect(performRestart).toHaveBeenCalledOnce();
        expect(initialiseDatabase).not.toHaveBeenCalled();
    });

    it("dismisses a suffix prompt during plug-in unload", async () => {
        const { tab, events, saveSettingData, performRestart } = createSettingsTab();
        const click = renderSuffixControl(tab);
        vi.mocked(promptText).mockImplementation(
            async (_app, _options, lifecycle) =>
                await new Promise((resolve) => {
                    lifecycle?.signal?.addEventListener("abort", () => resolve(null), { once: true });
                })
        );

        const confirmation = click();
        expect(promptText).toHaveBeenCalledOnce();
        events.emitEvent(EVENT_PLUGIN_UNLOADED);
        await confirmation;

        expect(saveSettingData).not.toHaveBeenCalled();
        expect(performRestart).not.toHaveBeenCalled();
    });
});
