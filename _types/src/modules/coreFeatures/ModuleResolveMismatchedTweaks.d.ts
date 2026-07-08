// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type TweakValues, type ObsidianLiveSyncSettings, type RemoteDBSettings } from "@lib/common/types.ts";
import { AbstractModule } from "@/modules/AbstractModule.ts";
import type { InjectableServiceHub } from "@lib/services/InjectableServices.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleResolvingMismatchedTweaks extends AbstractModule {
    private _hasNotifiedAutoAcceptCompatibleUndefined;
    private _collectMismatchedTweakKeys;
    private _selectNewerTweakSide;
    private _shouldAutoAcceptCompatibleLossy;
    /**
     * Hook before saving settings, to check if there are changes in tweak values, and if so,
     * update the tweakModified timestamp to current time.
     * This allows other devices to know that the tweak values have been changed and decide whether to accept the new values based on the modification time.
     * @param next
     * @param previous
     * @returns
     */
    _onBeforeSaveSettingData(next: ObsidianLiveSyncSettings, previous: ObsidianLiveSyncSettings): Promise<{
        tweakModified: number;
    } | undefined>;
    _anyAfterConnectCheckFailed(): Promise<boolean | "CHECKAGAIN" | undefined>;
    _checkAndAskResolvingMismatchedTweaks(preferred: TweakValues): Promise<[TweakValues | boolean, boolean]>;
    _askResolvingMismatchedTweaks(): Promise<"OK" | "CHECKAGAIN" | "IGNORE">;
    _fetchRemotePreferredTweakValues(trialSetting: RemoteDBSettings): Promise<TweakValues | false>;
    _checkAndAskUseRemoteConfiguration(trialSetting: RemoteDBSettings): Promise<{
        result: false | TweakValues;
        requireFetch: boolean;
    }>;
    _askUseRemoteConfiguration(trialSetting: RemoteDBSettings, preferred: TweakValues): Promise<{
        result: false | TweakValues;
        requireFetch: boolean;
    }>;
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void;
}
