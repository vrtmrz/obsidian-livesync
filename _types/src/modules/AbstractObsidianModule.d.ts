import type { Prettify } from "@lib/common/models/shared.type.util";
import type { LiveSyncCore } from "@/main";
import type ObsidianLiveSyncPlugin from "@/main";
import { AbstractModule } from "./AbstractModule.ts";
import type { ChainableExecuteFunction, OverridableFunctionsKeys } from "./ModuleTypes";
export type IObsidianModuleBase = OverridableFunctionsKeys<ObsidianLiveSyncPlugin>;
export type IObsidianModule = Prettify<Partial<IObsidianModuleBase>>;
export type ModuleKeys = keyof IObsidianModule;
export type ChainableModuleProps = ChainableExecuteFunction<ObsidianLiveSyncPlugin>;
export declare abstract class AbstractObsidianModule extends AbstractModule {
    plugin: ObsidianLiveSyncPlugin;
    get app(): import("obsidian").App;
    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore);
    isThisModuleEnabled(): boolean;
}
