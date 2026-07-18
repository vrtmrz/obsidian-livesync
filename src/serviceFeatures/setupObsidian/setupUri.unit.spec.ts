import { describe, expect, it, vi, afterEach } from "vitest";
import { EVENT_REQUEST_COPY_SETUP_URI } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { askEncryptingPassphrase, copySetupURI, copySetupURIFull, useSetupURIFeature } from "./setupUri";
import { encodeSettingsToSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";

vi.mock("@vrtmrz/livesync-commonlib/compat/API/processSetting", () => {
    return {
        encodeSettingsToSetupURI: vi.fn(),
    };
});

describe("setupObsidian/setupUri", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("askEncryptingPassphrase should delegate to confirm.askString", async () => {
        const askString = vi.fn(() => "secret");
        const host = {
            services: {
                UI: {
                    confirm: {
                        askString,
                    },
                },
            },
        } as any;

        const result = await askEncryptingPassphrase(host);
        expect(result).toBe("secret");
        expect(askString).toHaveBeenCalled();
    });

    it("copySetupURI should return early when user cancels passphrase", async () => {
        const promptCopyToClipboard = vi.fn();
        const host = {
            services: {
                setting: {
                    currentSettings: vi.fn(() => ({ foo: "bar" })),
                },
                UI: {
                    confirm: {
                        askString: vi.fn(() => false),
                    },
                    promptCopyToClipboard,
                },
            },
        } as any;
        const log = vi.fn();

        await copySetupURI(host, log);

        expect(encodeSettingsToSetupURI).not.toHaveBeenCalled();
        expect(promptCopyToClipboard).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });

    it("copySetupURI should encode with short mode by default", async () => {
        const promptCopyToClipboard = vi.fn(() => true);
        const currentSettings = { pluginSyncExtendedSetting: true, x: 1 };
        const host = {
            services: {
                setting: {
                    currentSettings: vi.fn(() => currentSettings),
                },
                UI: {
                    confirm: {
                        askString: vi.fn(() => "pass"),
                    },
                    promptCopyToClipboard,
                },
            },
        } as any;
        const log = vi.fn();
        vi.mocked(encodeSettingsToSetupURI).mockResolvedValue("uri://value" as any);

        await copySetupURI(host, log);

        expect(encodeSettingsToSetupURI).toHaveBeenCalledWith(
            currentSettings,
            "pass",
            ["pluginSyncExtendedSetting"],
            true
        );
        expect(promptCopyToClipboard).toHaveBeenCalledWith("Setup URI", "uri://value");
        expect(log).toHaveBeenCalled();
    });

    it("copySetupURIFull should encode with full mode", async () => {
        const promptCopyToClipboard = vi.fn(() => true);
        const currentSettings = { pluginSyncExtendedSetting: true, x: 1 };
        const host = {
            services: {
                setting: {
                    currentSettings: vi.fn(() => currentSettings),
                },
                UI: {
                    confirm: {
                        askString: vi.fn(() => "pass-full"),
                    },
                    promptCopyToClipboard,
                },
            },
        } as any;
        const log = vi.fn();
        vi.mocked(encodeSettingsToSetupURI).mockResolvedValue("uri://full" as any);

        await copySetupURIFull(host, log);

        expect(encodeSettingsToSetupURI).toHaveBeenCalledWith(currentSettings, "pass-full", [], false);
        expect(promptCopyToClipboard).toHaveBeenCalledWith("Setup URI", "uri://full");
        expect(log).toHaveBeenCalled();
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
});
