import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { TweakValueService } from "@lib/services/base/TweakValueService";
export declare class InjectableTweakValueService<T extends ServiceContext> extends TweakValueService<T> {
    fetchRemotePreferred: import("@lib/services/lib/HandlerUtils").HandlerFunction<(trialSetting: import("../../../common/types").RemoteDBSettings) => Promise<import("../../../common/types").TweakValues | false>, any>;
    checkAndAskResolvingMismatched: import("@lib/services/lib/HandlerUtils").HandlerFunction<(preferred: Partial<import("../../../common/types").TweakValues>) => Promise<[import("../../../common/types").TweakValues | boolean, boolean]>, any>;
    askResolvingMismatched: import("@lib/services/lib/HandlerUtils").HandlerFunction<(preferredSource: import("../../../common/types").TweakValues) => Promise<"OK" | "CHECKAGAIN" | "IGNORE">, any>;
    checkAndAskUseRemoteConfiguration: import("@lib/services/lib/HandlerUtils").HandlerFunction<(settings: import("../../../common/types").RemoteDBSettings) => Promise<{
        result: false | import("../../../common/types").TweakValues;
        requireFetch: boolean;
    }>, any>;
    askUseRemoteConfiguration: import("@lib/services/lib/HandlerUtils").HandlerFunction<(trialSetting: import("../../../common/types").RemoteDBSettings, preferred: import("../../../common/types").TweakValues) => Promise<{
        result: false | import("../../../common/types").TweakValues;
        requireFetch: boolean;
    }>, any>;
}
