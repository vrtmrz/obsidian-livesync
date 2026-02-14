import { AppLifecycleServiceBase } from "@/lib/src/services/implements/injectable/InjectableAppLifecycleService";
import type { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";
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
