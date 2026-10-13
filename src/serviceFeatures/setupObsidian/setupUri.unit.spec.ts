import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EVENT_REQUEST_COPY_SETUP_URI } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import {
    encodeTimeBoundSetupURI,
    getTimeBoundSetupURIUsableUntil,
    isTimeBoundSetupURIUsableNow,
} from "@vrtmrz/livesync-commonlib/setup-uri";
import { askEncryptingPassphrase, copySetupURI, copySetupURIFull, useSetupURIFeature } from "./setupUri";

vi.mock("@vrtmrz/livesync-commonlib/setup-uri", () => ({
    encodeTimeBoundSetupURI: vi.fn(),
    getTimeBoundSetupURIUsableUntil: vi.fn(),
    isTimeBoundSetupURIUsableNow: vi.fn(),
}));

describe("setupObsidian/setupUri", () => {
    const usableUntil = Date.parse("2026-10-01T00:00:00Z");

    beforeEach(() => {
        vi.mocked(getTimeBoundSetupURIUsableUntil).mockReturnValue(usableUntil);
        vi.mocked(encodeTimeBoundSetupURI).mockResolvedValue({ uri: "obsidian://setup-time-bound ", usableUntil });
        vi.mocked(isTimeBoundSetupURIUsableNow).mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetAllMocks();
    });

    it("uses the existing password prompt", async () => {
        const askString = vi.fn(async () => "secret");
        const host = { services: { UI: { confirm: { askString } } } } as any;

        await expect(askEncryptingPassphrase(host)).resolves.toBe("secret");
        expect(askString).toHaveBeenCalledWith(
            "Encrypt your settings",
            "The passphrase to encrypt the setup URI",
            "",
            true
        );
    });

    it("shows the exact Time-bound end at selection and uses it by default", async () => {
        const askSelectStringDialogue = vi.fn(async () => "Time-bound");
        const promptCopyToClipboard = vi.fn(async () => true);
        const currentSettings = { pluginSyncExtendedSetting: true, x: 1 };
        const host = {
            services: {
                setting: { currentSettings: vi.fn(() => currentSettings) },
                UI: {
                    confirm: { askString: vi.fn(async () => "pass"), askSelectStringDialogue },
                    promptCopyToClipboard,
                },
            },
        } as any;
        const log = vi.fn();

        await copySetupURI(host, log);

        expect(askSelectStringDialogue).toHaveBeenCalledWith(
            expect.stringContaining("2026"),
            ["Time-bound", "Compatible (no time limit)", "Cancel"],
            {
                title: "Setup URI availability",
                defaultAction: "Time-bound",
            }
        );
        expect(encodeTimeBoundSetupURI).toHaveBeenCalledWith(currentSettings, "pass", {
            mode: "ephemeral",
            removeProperties: ["pluginSyncExtendedSetting"],
            skipDefaultValue: true,
        });
        expect(promptCopyToClipboard).toHaveBeenCalledWith("Setup URI", "obsidian://setup-time-bound ");
        expect(log).toHaveBeenCalled();
    });

    it("selects old-reader-compatible output without a time limit and preserves full export settings", async () => {
        const promptCopyToClipboard = vi.fn(async () => true);
        const currentSettings = { pluginSyncExtendedSetting: true, x: 1 };
        const host = {
            services: {
                setting: { currentSettings: vi.fn(() => currentSettings) },
                UI: {
                    confirm: {
                        askString: vi.fn(async () => "pass"),
                        askSelectStringDialogue: vi.fn(async () => "Compatible (no time limit)"),
                    },
                    promptCopyToClipboard,
                },
            },
        } as any;
        const log = vi.fn();
        vi.mocked(encodeTimeBoundSetupURI).mockResolvedValue({
            uri: "obsidian://setup-compatible ",
            usableUntil: null,
        });

        await copySetupURIFull(host, log);

        expect(encodeTimeBoundSetupURI).toHaveBeenCalledWith(currentSettings, "pass", {
            mode: "persistent",
            removeProperties: [],
            skipDefaultValue: false,
        });
        expect(promptCopyToClipboard).toHaveBeenCalledWith("Setup URI", "obsidian://setup-compatible ");
        expect(log).toHaveBeenCalled();
    });

    it("keeps Compatible available when the clock is invalid", async () => {
        vi.mocked(getTimeBoundSetupURIUsableUntil).mockImplementation(() => {
            throw new Error("Invalid Setup URI clock");
        });
        vi.mocked(encodeTimeBoundSetupURI).mockResolvedValue({ uri: "compatible", usableUntil: null });
        const askSelectStringDialogue = vi.fn(async () => "Compatible (no time limit)");
        const host = {
            services: {
                setting: { currentSettings: vi.fn(() => ({})) },
                UI: {
                    confirm: { askString: vi.fn(async () => "pass"), askSelectStringDialogue },
                    promptCopyToClipboard: vi.fn(async () => false),
                },
            },
        } as any;

        await copySetupURI(host, vi.fn());

        expect(askSelectStringDialogue).toHaveBeenCalledWith(
            expect.stringContaining("valid device clock"),
            ["Compatible (no time limit)", "Cancel"],
            expect.objectContaining({ defaultAction: "Compatible (no time limit)" })
        );
    });

    it("does not generate after password or mode cancellation", async () => {
        const askString = vi.fn(async (): Promise<string | false> => false);
        const askSelectStringDialogue = vi.fn(async () => "Cancel");
        const promptCopyToClipboard = vi.fn();
        const host = {
            services: {
                setting: { currentSettings: vi.fn(() => ({})) },
                UI: { confirm: { askString, askSelectStringDialogue }, promptCopyToClipboard },
            },
        } as any;

        await copySetupURI(host, vi.fn());
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        askString.mockResolvedValueOnce("pass");
        await copySetupURI(host, vi.fn());
        expect(encodeTimeBoundSetupURI).not.toHaveBeenCalled();
        expect(promptCopyToClipboard).not.toHaveBeenCalled();
    });

    it("keeps an empty passphrase distinct from cancelling the existing prompt", async () => {
        vi.mocked(encodeTimeBoundSetupURI).mockResolvedValue({ uri: "compatible", usableUntil: null });
        const promptCopyToClipboard = vi.fn(async () => false);
        const host = {
            services: {
                setting: { currentSettings: vi.fn(() => ({})) },
                UI: {
                    confirm: {
                        askString: vi.fn(async () => ""),
                        askSelectStringDialogue: vi.fn(async () => "Compatible (no time limit)"),
                    },
                    promptCopyToClipboard,
                },
            },
        } as any;

        await copySetupURI(host, vi.fn());

        expect(encodeTimeBoundSetupURI).toHaveBeenCalledWith({}, "", expect.objectContaining({ mode: "persistent" }));
        expect(promptCopyToClipboard).toHaveBeenCalledWith("Setup URI", "compatible");
    });

    it("asks again if the window changes after selection", async () => {
        const nextUntil = usableUntil + 604_800_000;
        vi.mocked(getTimeBoundSetupURIUsableUntil).mockReturnValueOnce(usableUntil).mockReturnValueOnce(nextUntil);
        vi.mocked(encodeTimeBoundSetupURI)
            .mockResolvedValueOnce({ uri: "old-window", usableUntil: nextUntil })
            .mockResolvedValueOnce({ uri: "new-window", usableUntil: nextUntil });
        const askSelectStringDialogue = vi.fn(async () => "Time-bound");
        const promptCopyToClipboard = vi.fn(async () => false);
        const host = {
            services: {
                setting: { currentSettings: vi.fn(() => ({})) },
                UI: {
                    confirm: { askString: vi.fn(async () => "pass"), askSelectStringDialogue },
                    promptCopyToClipboard,
                },
            },
        } as any;

        await copySetupURI(host, vi.fn());

        expect(askSelectStringDialogue).toHaveBeenCalledTimes(2);
        expect(promptCopyToClipboard).toHaveBeenCalledTimes(1);
        expect(promptCopyToClipboard).toHaveBeenCalledWith("Setup URI", "new-window");
    });

    it("useSetupURIFeature should register onLoaded handler that wires commands and event", async () => {
        const addHandler = vi.fn();
        const addCommand = vi.fn();
        const context = createServiceContext();
        const onEventSpy = vi.spyOn(context.events, "onEvent");

        const host = {
            services: {
                context,
                API: {
                    addCommand,
                    addLog: vi.fn(),
                },
                appLifecycle: {
                    onLoaded: {
                        addHandler,
                    },
                },
                setting: {
                    currentSettings: vi.fn(() => ({ x: 1 })),
                },
                UI: {
                    confirm: {
                        askString: vi.fn(() => "pass"),
                    },
                    promptCopyToClipboard: vi.fn(() => true),
                },
            },
        } as any;

        useSetupURIFeature(host);
        expect(addHandler).toHaveBeenCalledTimes(1);

        const loadedHandler = addHandler.mock.calls[0][0] as () => Promise<boolean>;
        await loadedHandler();

        expect(addCommand).toHaveBeenCalledTimes(3);
        expect(addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "livesync-copysetupuri" }));
        expect(addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "livesync-copysetupuri-short" }));
        expect(addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "livesync-copysetupurifull" }));
        expect(onEventSpy).toHaveBeenCalledWith(EVENT_REQUEST_COPY_SETUP_URI, expect.any(Function));
    });

    it("shows Setup URI variants only when their configuration level is relevant", async () => {
        const addHandler = vi.fn();
        const commands: Array<{
            id: string;
            checkCallback?: (checking: boolean) => boolean | void;
        }> = [];
        const settings = {
            isConfigured: false,
            usePluginSync: false,
            useAdvancedMode: false,
        };
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    addCommand: vi.fn((command) => commands.push(command)),
                    addLog: vi.fn(),
                },
                appLifecycle: {
                    onLoaded: {
                        addHandler,
                    },
                },
                setting: {
                    currentSettings: vi.fn(() => settings),
                },
                UI: {
                    confirm: {
                        askString: vi.fn(() => "pass"),
                    },
                    promptCopyToClipboard: vi.fn(() => true),
                },
            },
        } as any;

        useSetupURIFeature(host);
        const loadedHandler = addHandler.mock.calls[0][0] as () => Promise<boolean>;
        await loadedHandler();

        const command = (id: string) => commands.find((candidate) => candidate.id === id)!;
        expect(command("livesync-copysetupuri").checkCallback?.(true)).toBe(false);

        settings.isConfigured = true;
        expect(command("livesync-copysetupuri").checkCallback?.(true)).toBe(true);
        expect(command("livesync-copysetupuri-short").checkCallback?.(true)).toBe(false);
        expect(command("livesync-copysetupurifull").checkCallback?.(true)).toBe(false);

        settings.usePluginSync = true;
        settings.useAdvancedMode = true;
        expect(command("livesync-copysetupuri-short").checkCallback?.(true)).toBe(true);
        expect(command("livesync-copysetupurifull").checkCallback?.(true)).toBe(true);
    });
});
