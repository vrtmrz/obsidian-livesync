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
    addCommand = this.services.API.addCommand.bind(this.services.API);
    registerView = this.services.API.registerWindow.bind(this.services.API);
    addRibbonIcon = this.services.API.addRibbonIcon.bind(this.services.API);
    registerObsidianProtocolHandler = this.services.API.registerProtocolHandler.bind(this.services.API);

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
