import { AppLifecycleServiceBase } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAppLifecycleService";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
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
        this.context.liveSyncPlugin.issue1189Diagnostics?.markRestartRequested();
        void this.context.plugin.app.commands.executeCommandById("app:reload");
    }
}
