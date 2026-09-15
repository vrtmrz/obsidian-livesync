import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { SetupFeatureHost } from "@/serviceFeatures/setupObsidian/types";
import { configURIBase, configURIBaseV2 } from "@/common/types";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { type SetupManager, UserMode } from "@/modules/features/SetupManager";

async function handleSetupProtocol(setupManager: SetupManager, conf: Record<string, string>, uriBase = configURIBase) {
    if (conf.settings) {
        await setupManager.onUseSetupURI(UserMode.Unknown, `${uriBase}${encodeURIComponent(conf.settings)}`);
    } else if (conf.settingsQR && uriBase === configURIBase) {
        await setupManager.decodeQR(conf.settingsQR);
    }
}

export function registerSetupProtocolHandler(host: SetupFeatureHost, log: LogFunction, setupManager: SetupManager) {
    try {
        host.services.API.registerProtocolHandler("setuplivesync-v2", async (conf) => {
            await handleSetupProtocol(setupManager, conf, configURIBaseV2);
        });
        host.services.API.registerProtocolHandler("setuplivesync", async (conf) => {
            await handleSetupProtocol(setupManager, conf);
        });
    } catch (e) {
        log("Failed to register protocol handler. This feature may not work in some environments.", LOG_LEVEL_NOTICE);
        log(e, LOG_LEVEL_VERBOSE);
    }
}

export function useSetupProtocolFeature(
    host: NecessaryServices<"API" | "UI" | "setting" | "appLifecycle", never>,
    setupManager: SetupManager
) {
    const log = createInstanceLogFunction("SF:SetupProtocol", host.services.API);
    host.services.appLifecycle.onLoaded.addHandler(() => {
        registerSetupProtocolHandler(host, log, setupManager);
        return Promise.resolve(true);
    });
}
