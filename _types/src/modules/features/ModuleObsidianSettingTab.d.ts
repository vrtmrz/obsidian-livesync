// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { ObsidianLiveSyncSettingTab } from "./SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleObsidianSettingDialogue extends AbstractObsidianModule {
    settingTab: ObsidianLiveSyncSettingTab;
    _everyOnloadStart(): Promise<boolean>;
    openSetting(): void;
    get appId(): string;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
