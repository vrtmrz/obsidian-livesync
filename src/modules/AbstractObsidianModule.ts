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
    addCommand = this.plugin.addCommand.bind(this.plugin);
    registerView = this.plugin.registerView.bind(this.plugin);
    addRibbonIcon = this.plugin.addRibbonIcon.bind(this.plugin);
    registerObsidianProtocolHandler = this.plugin.registerObsidianProtocolHandler.bind(this.plugin);

    get localDatabase() {
        return this.plugin.localDatabase;
    }
    get settings() {
        return this.plugin.settings;
    }
    set settings(value) {
        this.plugin.settings = value;
    }
    get app() {
        return this.plugin.app;
    }

    constructor(
        public plugin: ObsidianLiveSyncPlugin,
        public core: LiveSyncCore
    ) {
        super(core);
    }

    saveSettings = this.plugin.saveSettings.bind(this.plugin);

    _isMainReady() {
        return this.services.appLifecycle.isReady();
    }
    _isMainSuspended() {
        return this.services.appLifecycle.isSuspended();
    }
    _isDatabaseReady() {
        return this.services.database.isDatabaseReady();
    }

    //should be overridden
    _isThisModuleEnabled() {
        return true;
    }
}
