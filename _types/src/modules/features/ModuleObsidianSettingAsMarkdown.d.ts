// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ObsidianLiveSyncSettings } from "@lib/common/types";
import { AbstractModule } from "@/modules/AbstractModule.ts";
import type { ServiceContext } from "@lib/services/base/ServiceBase.ts";
import type { InjectableServiceHub } from "@lib/services/InjectableServices.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleObsidianSettingsAsMarkdown extends AbstractModule {
    _everyOnloadStart(): Promise<boolean>;
    extractSettingFromWholeText(data: string): {
        preamble: string;
        body: string;
        postscript: string;
    };
    parseSettingFromMarkdown(filename: string, data?: string): Promise<{
        preamble: string;
        body: string;
        postscript: string;
    }>;
    checkAndApplySettingFromMarkdown(filename: string, automated?: boolean): Promise<void>;
    generateSettingForMarkdown(settings?: ObsidianLiveSyncSettings, keepCredential?: boolean): Partial<ObsidianLiveSyncSettings>;
    saveSettingToMarkdown(filename: string): Promise<void>;
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub<ServiceContext>): void;
}
