import type { LiveSyncCore } from "@/main";
import type ObsidianLiveSyncPlugin from "@/main";
import { AbstractModule } from "./AbstractModule.ts";

export abstract class AbstractObsidianModule extends AbstractModule {
    get app() {
        return this.plugin.app;
    }

    constructor(
        public plugin: ObsidianLiveSyncPlugin,
        core: LiveSyncCore
    ) {
        super(core);
    }

    //should be overridden
    isThisModuleEnabled() {
        return true;
    }
}
