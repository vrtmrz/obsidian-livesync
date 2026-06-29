// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { RemoteDBSettings, TweakValues } from "@lib/common/types";
import type { ITweakValueService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
/**
 * The TweakValueService provides methods for managing tweak values and resolving mismatches.
 */
export declare abstract class TweakValueService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements ITweakValueService {
    /**
     * Fetch and trial the remote database settings to determine if they are preferred.
     * @param trialSetting The remote database settings to connect.
     */
    abstract fetchRemotePreferred(trialSetting: RemoteDBSettings): Promise<TweakValues | false>;
    /**
     * Check and ask the user to resolve any mismatched tweak values.
     * @param preferred The preferred tweak values to check against.
     */
    abstract checkAndAskResolvingMismatched(preferred: Partial<TweakValues>): Promise<[TweakValues | boolean, boolean]>;
    /**
     * Ask the user to resolve any mismatched tweak values.
     * @param preferredSource The preferred tweak values to resolve against.
     */
    abstract askResolvingMismatched(preferredSource: TweakValues): Promise<"OK" | "CHECKAGAIN" | "IGNORE">;
    /**
     * Check and ask the user to use the remote configuration.
     * @param settings The remote database settings to connect.
     */
    abstract checkAndAskUseRemoteConfiguration(settings: RemoteDBSettings): Promise<{
        result: false | TweakValues;
        requireFetch: boolean;
    }>;
    /**
     * Ask the user to use the remote configuration.
     * @param trialSetting The remote database settings to connect.
     * @param preferred The preferred tweak values to use.
     */
    abstract askUseRemoteConfiguration(trialSetting: RemoteDBSettings, preferred: TweakValues): Promise<{
        result: false | TweakValues;
        requireFetch: boolean;
    }>;
}
