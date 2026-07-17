import { type SetupManager, UserMode } from "@/modules/features/SetupManager";
import type { SetupFeatureHost } from "@/serviceFeatures/setupObsidian/types";
import { EVENT_REQUEST_OPEN_P2P_SETTINGS, EVENT_REQUEST_OPEN_SETUP_URI } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";

export async function openSetupURI(setupManager: SetupManager) {
    await setupManager.onUseSetupURI(UserMode.Unknown);
}

export async function openP2PSettings(host: SetupFeatureHost, setupManager: SetupManager) {
    return await setupManager.onP2PManualSetup(UserMode.Update, host.services.setting.currentSettings(), false);
}

export function useSetupManagerHandlersFeature(
    host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>,
    setupManager: SetupManager
) {
    host.services.appLifecycle.onLoaded.addHandler(() => {
        host.services.API.addCommand({
            id: "livesync-opensetupuri",
            name: "Use the copied setup URI (Formerly Open setup URI)",
            callback: () => fireAndForget(openSetupURI(setupManager)),
        });

        host.services.context.events.onEvent(EVENT_REQUEST_OPEN_SETUP_URI, () =>
            fireAndForget(() => openSetupURI(setupManager))
        );
        host.services.context.events.onEvent(EVENT_REQUEST_OPEN_P2P_SETTINGS, () =>
            fireAndForget(() => openP2PSettings(host, setupManager))
        );

        return Promise.resolve(true);
    });
}
