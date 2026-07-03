// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { AppLifecycleServiceBase } from "@lib/services/implements/injectable/InjectableAppLifecycleService";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
declare module "obsidian" {
    interface App {
        commands: {
            executeCommandById: (id: string) => Promise<void>;
        };
    }
}
export declare class ObsidianAppLifecycleService<T extends ObsidianServiceContext> extends AppLifecycleServiceBase<T> {
    performRestart(): void;
}
