// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import type ObsidianLiveSyncPlugin from "@/main";
export declare class ObsidianServiceHub extends InjectableServiceHub<ObsidianServiceContext> {
    constructor(plugin: ObsidianLiveSyncPlugin);
}
