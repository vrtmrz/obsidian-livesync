import type { AnyEntry, DocumentID, FilePath, FilePathWithPrefix } from "@lib/common/models/db.type";
import type { LOG_LEVEL } from "@lib/common/logger";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import type { LiveSyncCore } from "@/main.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
export declare abstract class LiveSyncCommands {
    /**
     * @deprecated This class is deprecated. Please use core
     */
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncCore;
    get app(): import("obsidian").App;
    get settings(): import("../lib/src/common/types").ObsidianLiveSyncSettings;
    get localDatabase(): import("../lib/src/pouchdb/LiveSyncLocalDB").LiveSyncLocalDB;
    get services(): import("../lib/src/services/InjectableServices").InjectableServiceHub<import("../lib/src/services/implements/obsidian/ObsidianServiceContext").ObsidianServiceContext>;
    path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID>;
    getPath(entry: AnyEntry): FilePathWithPrefix;
    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore);
    abstract onunload(): void;
    abstract onload(): void | Promise<void>;
    _isMainReady(): boolean;
    _isMainSuspended(): boolean;
    _isDatabaseReady(): boolean;
    _log: ReturnType<typeof createInstanceLogFunction>;
    _verbose: (msg: unknown, key?: string) => void;
    _info: (msg: unknown, key?: string) => void;
    _notice: (msg: unknown, key?: string) => void;
    _progress: (prefix?: string, level?: LOG_LEVEL) => {
        log: (msg: unknown) => void;
        once: (msg: unknown) => void;
        done: (msg?: string) => void;
    };
    _debug: (msg: unknown, key?: string) => void;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
