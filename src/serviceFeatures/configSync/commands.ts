import { addIcon } from "@/deps.ts";
import { $msg } from "@lib/common/i18n.ts";
import type { ConfigSyncHost } from "./types.ts";

/**
 * Registers commands, ribbon icons, and custom SVG icons for configuration synchronisation.
 *
 * @param host - The service feature host.
 * @param handlers - Action triggers.
 */
export function registerConfigSyncCommands(
    host: ConfigSyncHost,
    handlers: {
        showPluginSyncModal: () => void;
    }
) {
    addIcon(
        "custom-sync",
        `<g transform="rotate(-90 75 218)"  fill="currentColor" fill-rule="evenodd">
            <path d="m272 166-9.38 9.38 9.38 9.38 9.38-9.38c1.96-1.93 5.11-1.9 7.03 0.058 1.91 1.94 1.91 5.04 0 6.98l-9.38 9.38 5.86 5.86-11.7 11.7c-8.34 8.35-21.4 9.68-31.3 3.19l-3.84 3.98c-8.45 8.7-20.1 13.6-32.2 13.6h-5.55v-9.95h5.55c9.43-0.0182 18.5-3.84 25-10.6l3.95-4.09c-6.54-9.86-5.23-23 3.14-31.3l11.7-11.7 5.86 5.86 9.38-9.38c1.96-1.93 5.11-1.9 7.03 0.0564 1.91 1.93 1.91 5.04 2e-3 6.98z"/>
        </g>`
    );

    host.services.API.addCommand({
        id: "livesync-plugin-dialog-ex",
        name: "Show customisation sync dialogue",
        callback: () => {
            handlers.showPluginSyncModal();
        },
    });

    const addRibbonIcon = host.services.API.addRibbonIcon.bind(host.services.API);
    addRibbonIcon("custom-sync", $msg("cmdConfigSync.showCustomizationSync"), () => {
        handlers.showPluginSyncModal();
    }).addClass("livesync-ribbon-showcustom");
}
