import { AppLifecycleServiceBase } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAppLifecycleService.js";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext.js";
declare module "obsidian" {
    interface App {
        commands: {
            executeCommandById: (id: string) => Promise<void>;
        };
    }
}
// InjectableAppLifecycleService
export class ObsidianAppLifecycleService<T extends ObsidianServiceContext> extends AppLifecycleServiceBase<T> {
    performRestart(): void {
        void this.context.plugin.app.commands.executeCommandById("app:reload");
    }
}
