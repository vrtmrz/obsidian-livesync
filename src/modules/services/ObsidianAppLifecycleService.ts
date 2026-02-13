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
    constructor(context: T) {
        super(context);
        // The main entry point when Obsidian's workspace is ready
        const onReady = this.onReady;
        this.context.app.workspace.onLayoutReady(onReady);
    }
    performRestart(): void {
        void this.context.plugin.app.commands.executeCommandById("app:reload");
    }
}
