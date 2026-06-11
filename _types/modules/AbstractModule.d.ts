import type { AnyEntry, FilePathWithPrefix } from "@lib/common/models/db.type";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare abstract class AbstractModule<T extends LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands> = LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>> {
    core: T;
    _log: (msg: unknown, level?: import("octagonal-wheels/common/logger").LOG_LEVEL, key?: string) => void;
    get services(): import("../lib/src/services/InjectableServices").InjectableServiceHub<ServiceContext>;
    addCommand: <TCommand extends import("../lib/src/services/base/IService").ICommandCompat>(command: TCommand) => TCommand;
    registerView: (type: string, factory: (leaf: any) => any) => void;
    addRibbonIcon: (icon: string, title: string, callback: (evt: MouseEvent) => any) => HTMLElement;
    registerObsidianProtocolHandler: (action: string, handler: (params: Record<string, string>) => any) => void;
    get localDatabase(): import("../lib/src/pouchdb/LiveSyncLocalDB").LiveSyncLocalDB;
    get settings(): import("../lib/src/common/types").ObsidianLiveSyncSettings;
    set settings(value: import("../lib/src/common/types").ObsidianLiveSyncSettings);
    getPath(entry: AnyEntry): FilePathWithPrefix;
    getPathWithoutPrefix(entry: AnyEntry): FilePathWithPrefix;
    onBindFunction(core: T, services: typeof core.services): void;
    constructor(core: T);
    saveSettings: () => Promise<void>;
    addTestResult(key: string, value: boolean, summary?: string, message?: string): void;
    testDone(result?: boolean): Promise<boolean>;
    testFail(message: string): Promise<boolean>;
    _test(key: string, process: () => Promise<unknown>): Promise<boolean>;
    isMainReady(): boolean;
    isMainSuspended(): boolean;
    isDatabaseReady(): boolean;
}
