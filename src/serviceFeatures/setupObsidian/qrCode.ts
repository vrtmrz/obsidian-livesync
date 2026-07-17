import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import {
    encodeQR,
    encodeSettingsToQRCodeData,
    OutputFormat,
} from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { EVENT_REQUEST_SHOW_SETUP_QR } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { SetupFeatureHost } from "./types";

export async function encodeSetupSettingsAsQR(host: SetupFeatureHost) {
    const settingString = encodeSettingsToQRCodeData(host.services.setting.currentSettings());
    const result = encodeQR(settingString, OutputFormat.SVG);
    if (result === "") {
        return "";
    }

    if (typeof result === "string") {
        const msg = host.services.context.translate("Setup.QRCode", { qr_image: result });
        await host.services.UI.confirm.confirmWithMessage("Settings QR Code", msg, ["OK"], "OK");
        return result;
    } else {
        // Multi-page QR code
        let currentIndex = 0;
        while (currentIndex < result.total) {
            const msg = `The setting is too large for a single QR code.
We are using the aggregator to combine multiple QR codes.
Your settings will not be sent to any server; they will be processed only on your device.
Please scan this QR code with your mobile's camera, and open the page in your browser.
After all parts are collected, the page will navigate you back to Obsidian with the aggregated settings.

Progress: ${currentIndex + 1} / ${result.total}
${result.parts[currentIndex]}`;

            const buttons = [];
            if (currentIndex > 0) buttons.push("Back");
            if (currentIndex < result.total - 1) {
                buttons.push("Next");
                buttons.push("Cancel");
            } else {
                buttons.push("Done");
            }

            const choice = await host.services.UI.confirm.confirmWithMessage(
                "Settings QR Code (Aggregated)",
                msg,
                buttons,
                buttons[buttons.indexOf("Next") !== -1 ? buttons.indexOf("Next") : buttons.indexOf("Done")]
            );

            if (choice === "Next") {
                currentIndex++;
            } else if (choice === "Back") {
                currentIndex--;
            } else {
                break;
            }
        }
        return result.parts[0]; // Return the first one for compatibility
    }
}

export function useSetupQRCodeFeature(host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>) {
    host.services.appLifecycle.onLoaded.addHandler(() => {
        host.services.API.addCommand({
            id: "livesync-setting-qr",
            name: "Show settings as a QR code",
            callback: () => fireAndForget(encodeSetupSettingsAsQR(host)),
        });
        host.services.context.events.onEvent(EVENT_REQUEST_SHOW_SETUP_QR, () =>
            fireAndForget(() => encodeSetupSettingsAsQR(host))
        );
        return Promise.resolve(true);
    });
}
