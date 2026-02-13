import { type Prettify } from "../lib/src/common/types";
import type { LiveSyncCore } from "../main";
import type ObsidianLiveSyncPlugin from "../main";
import { AbstractModule } from "./AbstractModule.ts";
import type { ChainableExecuteFunction, OverridableFunctionsKeys } from "./ModuleTypes";

export type IObsidianModuleBase = OverridableFunctionsKeys<ObsidianLiveSyncPlugin>;
export type IObsidianModule = Prettify<Partial<IObsidianModuleBase>>;
export type ModuleKeys = keyof IObsidianModule;
export type ChainableModuleProps = ChainableExecuteFunction<ObsidianLiveSyncPlugin>;

export abstract class AbstractObsidianModule extends AbstractModule {
    get app() {
        return this.plugin.app;
    }

    constructor(
        public plugin: ObsidianLiveSyncPlugin,
        public core: LiveSyncCore
    ) {
        super(core);
    }

    //should be overridden
    isThisModuleEnabled() {
        return true;
    }
}
