import { describe, expect, it, vi, afterEach } from "vitest";
import { EVENT_REQUEST_SHOW_SETUP_QR } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { encodeSetupSettingsAsQR, useSetupQRCodeFeature } from "./qrCode";
import { encodeQR, encodeSettingsToQRCodeData } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";

vi.mock("@vrtmrz/livesync-commonlib/compat/API/processSetting", () => {
    return {
        encodeQR: vi.fn(),
        encodeSettingsToQRCodeData: vi.fn(),
        OutputFormat: {
            SVG: "svg",
        },
    };
});

describe("setupObsidian/qrCode", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("encodeSetupSettingsAsQR should return empty string when QR generation fails", async () => {
        const confirmWithMessage = vi.fn();
        const host = {
            services: {
                context: createServiceContext(),
                setting: {
                    currentSettings: vi.fn(() => ({ any: "settings" })),
                },
                UI: {
                    confirm: {
                        confirmWithMessage,
                    },
                },
            },
        } as any;

        vi.mocked(encodeSettingsToQRCodeData).mockReturnValue("encoded-settings");
        vi.mocked(encodeQR).mockReturnValue("");

        const result = await encodeSetupSettingsAsQR(host);

        expect(result).toBe("");
        expect(confirmWithMessage).not.toHaveBeenCalled();
    });

    it("encodeSetupSettingsAsQR should show confirm dialog when QR is generated", async () => {
        const confirmWithMessage = vi.fn(() => true);
        const translate = vi.fn(() => "qr-message");
        const host = {
            services: {
                context: createServiceContext({ translate }),
                setting: {
                    currentSettings: vi.fn(() => ({ any: "settings" })),
                },
                UI: {
                    confirm: {
                        confirmWithMessage,
                    },
                },
            },
        } as any;

        vi.mocked(encodeSettingsToQRCodeData).mockReturnValue("encoded-settings");
        vi.mocked(encodeQR).mockReturnValue("<svg/>");

        const result = await encodeSetupSettingsAsQR(host);

        expect(result).toBe("<svg/>");
        expect(translate).toHaveBeenCalledWith("Setup.QRCode", { qr_image: "<svg/>" });
        expect(confirmWithMessage).toHaveBeenCalledWith("Settings QR Code", "qr-message", ["OK"], "OK");
    });

    it("useSetupQRCodeFeature should register onLoaded handler that wires command and event", async () => {
        const addHandler = vi.fn();
        const addCommand = vi.fn();
        const context = createServiceContext();
        const onEventSpy = vi.spyOn(context.events, "onEvent");

        const host = {
            services: {
                context,
                API: {
                    addCommand,
                },
                appLifecycle: {
                    onLoaded: {
                        addHandler,
                    },
                },
                setting: {
                    currentSettings: vi.fn(() => ({ any: "settings" })),
                },
                UI: {
                    confirm: {
                        confirmWithMessage: vi.fn(),
                    },
                },
            },
        } as any;

        useSetupQRCodeFeature(host);
        expect(addHandler).toHaveBeenCalledTimes(1);

        const loadedHandler = addHandler.mock.calls[0][0] as () => Promise<boolean>;
        await loadedHandler();

        expect(addCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "livesync-setting-qr",
                name: "Show settings as a QR code",
            })
        );
        expect(onEventSpy).toHaveBeenCalledWith(EVENT_REQUEST_SHOW_SETUP_QR, expect.any(Function));
    });
});
