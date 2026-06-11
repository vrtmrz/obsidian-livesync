import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleDev extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean>;
    onMissingTranslation(key: string): Promise<void>;
    private _everyOnloadAfterLoadSettings;
    _everyOnLayoutReady(): Promise<boolean>;
    testResults: import("svelte/store").Writable<[boolean, string, string][]>;
    private _addTestResult;
    private _everyModuleTest;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
