import type { LiveSyncCore } from "@/main.js";
import type ObsidianLiveSyncPlugin from "@/main.js";
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
