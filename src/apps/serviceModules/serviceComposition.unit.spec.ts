import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { initialiseServiceModulesCLI } from "@/apps/cli/serviceModules/CLIServiceModules";
import { initialiseServiceModulesFSAPI } from "@/apps/webapp/serviceModules/FSAPIServiceModules";
import { FILE_REFLECTION_PROVENANCE_STORE } from "@/serviceModules/FileReflectionProvenance";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";

const composition = vi.hoisted(() => ({
    calls: [] as string[],
    dependencies: {} as Record<string, unknown>,
    instances: {} as Record<string, unknown>,
    capture(name: string, dependencies: unknown, instance: unknown) {
        this.calls.push(name);
        this.dependencies[name] = dependencies;
        this.instances[name] = instance;
    },
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/managers/StorageProcessingManager", () => ({
    StorageAccessManager: class {
        constructor() {
            composition.capture("StorageAccessManager", undefined, this);
        }
    },
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder", () => ({
    ServiceRebuilder: class {
        constructor(dependencies: unknown) {
            composition.capture("ServiceRebuilder", dependencies, this);
        }
    },
}));

vi.mock("@/serviceModules/FileHandler", () => ({
    ServiceFileHandler: class {
        constructor(dependencies: unknown) {
            composition.capture("ServiceFileHandler", dependencies, this);
        }
    },
}));

vi.mock("@/apps/cli/serviceModules/FileAccessCLI", () => ({
    FileAccessCLI: class {
        constructor(...args: unknown[]) {
            composition.capture("FileAccessCLI", args, this);
        }
    },
}));

vi.mock("@/apps/cli/serviceModules/ServiceFileAccessImpl", () => ({
    ServiceFileAccessCLI: class {
        constructor(dependencies: unknown) {
            composition.capture("ServiceFileAccessCLI", dependencies, this);
        }
    },
}));

vi.mock("@/apps/cli/serviceModules/DatabaseFileAccess", () => ({
    ServiceDatabaseFileAccessCLI: class {
        constructor(dependencies: unknown) {
            composition.capture("ServiceDatabaseFileAccessCLI", dependencies, this);
        }
    },
}));

vi.mock("@/apps/cli/managers/StorageEventManagerCLI", () => ({
    StorageEventManagerCLI: class {
        close = vi.fn(async () => undefined);

        constructor(...args: unknown[]) {
            composition.capture("StorageEventManagerCLI", args, this);
        }
    },
}));

vi.mock("@/apps/webapp/serviceModules/FileAccessFSAPI", () => ({
    FileAccessFSAPI: class {
        constructor(...args: unknown[]) {
            composition.capture("FileAccessFSAPI", args, this);
        }
    },
}));

vi.mock("@/apps/webapp/serviceModules/ServiceFileAccessImpl", () => ({
    ServiceFileAccessFSAPI: class {
        constructor(dependencies: unknown) {
            composition.capture("ServiceFileAccessFSAPI", dependencies, this);
        }
    },
}));

vi.mock("@/apps/webapp/serviceModules/DatabaseFileAccess", () => ({
    ServiceDatabaseFileAccessFSAPI: class {
        constructor(dependencies: unknown) {
            composition.capture("ServiceDatabaseFileAccessFSAPI", dependencies, this);
        }
    },
}));

vi.mock("@/apps/webapp/managers/StorageEventManagerFSAPI", () => ({
    StorageEventManagerFSAPI: class {
        constructor(...args: unknown[]) {
            composition.capture("StorageEventManagerFSAPI", args, this);
        }
    },
}));

function createServices() {
    const hostServices = Object.fromEntries(
        [
            "API",
            "conflict",
            "control",
            "database",
            "databaseEvents",
            "fileProcessing",
            "path",
            "remote",
            "replication",
            "replicator",
            "setting",
            "UI",
            "vault",
        ].map((name) => [name, { name }])
    );
    const events = { label: "host event hub" };
    const addUnloadHandler = vi.fn<(handler: () => Promise<boolean>) => void>();
    const openSimpleStore = vi.fn((name: string) => {
        composition.calls.push("openSimpleStore");
        composition.dependencies.openSimpleStore = name;
        return { name };
    });

    return {
        ...hostServices,
        appLifecycle: { onUnload: { addHandler: addUnloadHandler } },
        context: { events },
        events,
        keyValueDB: { openSimpleStore },
        addUnloadHandler,
    };
}

function createCore() {
    return {} as LiveSyncBaseCore<ServiceContext, never>;
}

beforeEach(() => {
    composition.calls.length = 0;
    composition.dependencies = {};
    composition.instances = {};
});

describe("app service module composition", () => {
    it("preserves CLI host construction, shared wiring, provenance, and watcher shutdown", async () => {
        const services = createServices();
        const core = createCore();

        const modules = initialiseServiceModulesCLI(
            "/vault",
            core,
            services as unknown as InjectableServiceHub<ServiceContext>
        );

        expect(composition.calls).toEqual([
            "StorageAccessManager",
            "FileAccessCLI",
            "StorageEventManagerCLI",
            "ServiceFileAccessCLI",
            "ServiceDatabaseFileAccessCLI",
            "openSimpleStore",
            "ServiceFileHandler",
            "ServiceRebuilder",
        ]);
        expect(composition.dependencies.openSimpleStore).toBe(FILE_REFLECTION_PROVENANCE_STORE);

        const [basePath, fileAccessOptions] = composition.dependencies.FileAccessCLI as [
            string,
            Record<string, unknown>,
        ];
        const [eventBasePath, eventCore, eventDependencies, ignoreRules, watchEnabled] = composition.dependencies
            .StorageEventManagerCLI as [string, unknown, Record<string, unknown>, unknown, boolean];
        const storageAccessDependencies = composition.dependencies.ServiceFileAccessCLI as Record<string, unknown>;
        const databaseAccessDependencies = composition.dependencies.ServiceDatabaseFileAccessCLI as Record<
            string,
            unknown
        >;
        const fileHandlerDependencies = composition.dependencies.ServiceFileHandler as Record<string, unknown>;
        const rebuilderDependencies = composition.dependencies.ServiceRebuilder as Record<string, unknown>;

        expect(basePath).toBe("/vault");
        expect(fileAccessOptions).toEqual({
            storageAccessManager: composition.instances.StorageAccessManager,
            vaultService: services.vault,
            settingService: services.setting,
            APIService: services.API,
            pathService: services.path,
        });
        expect(eventBasePath).toBe("/vault");
        expect(eventCore).toBe(core);
        expect(eventDependencies).toEqual({
            fileProcessing: services.fileProcessing,
            setting: services.setting,
            vaultService: services.vault,
            storageAccessManager: composition.instances.StorageAccessManager,
            APIService: services.API,
        });
        expect(ignoreRules).toBeUndefined();
        expect(watchEnabled).toBe(false);
        expect(storageAccessDependencies).toEqual({
            API: services.API,
            setting: services.setting,
            fileProcessing: services.fileProcessing,
            vault: services.vault,
            appLifecycle: services.appLifecycle,
            storageEventManager: composition.instances.StorageEventManagerCLI,
            storageAccessManager: composition.instances.StorageAccessManager,
            vaultAccess: composition.instances.FileAccessCLI,
        });
        expect(databaseAccessDependencies).toEqual({
            events: services.events,
            API: services.API,
            database: services.database,
            path: services.path,
            storageAccess: modules.storageAccess,
            vault: services.vault,
        });
        expect(modules.databaseFileAccess).toBe(composition.instances.ServiceDatabaseFileAccessCLI);
        expect(modules.fileHandler).toBe(composition.instances.ServiceFileHandler);
        expect(modules.rebuilder).toBe(composition.instances.ServiceRebuilder);
        expect(fileHandlerDependencies).toEqual({
            events: services.events,
            API: services.API,
            databaseFileAccess: modules.databaseFileAccess,
            conflict: services.conflict,
            setting: services.setting,
            fileProcessing: services.fileProcessing,
            vault: services.vault,
            path: services.path,
            replication: services.replication,
            storageAccess: modules.storageAccess,
            fileReflectionProvenance: expect.any(Object),
        });
        expect(rebuilderDependencies).toEqual({
            path: services.path,
            events: services.events,
            API: services.API,
            database: services.database,
            appLifecycle: services.appLifecycle,
            setting: services.setting,
            remote: services.remote,
            databaseEvents: services.databaseEvents,
            replication: services.replication,
            replicator: services.replicator,
            UI: services.UI,
            vault: services.vault,
            fileHandler: modules.fileHandler,
            fileProcessing: services.fileProcessing,
            storageAccess: modules.storageAccess,
            control: services.control,
        });

        const unloadHandler = services.addUnloadHandler.mock.calls[0]?.[0];
        expect(unloadHandler).toBeDefined();
        await expect(unloadHandler?.()).resolves.toBe(true);
        expect(
            (composition.instances.StorageEventManagerCLI as { close: ReturnType<typeof vi.fn> }).close
        ).toHaveBeenCalledOnce();
    });

    it("preserves WebApp host construction and returns its vault access and event manager", () => {
        const services = createServices();
        const core = createCore();
        const rootHandle = {} as FileSystemDirectoryHandle;

        const modules = initialiseServiceModulesFSAPI(
            rootHandle,
            core,
            services as unknown as InjectableServiceHub<ServiceContext>
        );

        expect(composition.calls).toEqual([
            "StorageAccessManager",
            "FileAccessFSAPI",
            "StorageEventManagerFSAPI",
            "ServiceFileAccessFSAPI",
            "ServiceDatabaseFileAccessFSAPI",
            "openSimpleStore",
            "ServiceFileHandler",
            "ServiceRebuilder",
        ]);
        expect(composition.dependencies.openSimpleStore).toBe(FILE_REFLECTION_PROVENANCE_STORE);
        const [fileAccessRoot, fileAccessOptions] = composition.dependencies.FileAccessFSAPI as [
            FileSystemDirectoryHandle,
            Record<string, unknown>,
        ];
        const [eventRoot, eventCore, eventDependencies] = composition.dependencies.StorageEventManagerFSAPI as [
            FileSystemDirectoryHandle,
            unknown,
            Record<string, unknown>,
        ];
        const storageAccessDependencies = composition.dependencies.ServiceFileAccessFSAPI as Record<string, unknown>;
        const databaseAccessDependencies = composition.dependencies.ServiceDatabaseFileAccessFSAPI as Record<
            string,
            unknown
        >;

        expect(fileAccessRoot).toBe(rootHandle);
        expect(fileAccessOptions).toEqual({
            storageAccessManager: composition.instances.StorageAccessManager,
            vaultService: services.vault,
            settingService: services.setting,
            APIService: services.API,
            pathService: services.path,
        });
        expect(eventRoot).toBe(rootHandle);
        expect(eventCore).toBe(core);
        expect(eventDependencies).toEqual({
            fileProcessing: services.fileProcessing,
            setting: services.setting,
            vaultService: services.vault,
            storageAccessManager: composition.instances.StorageAccessManager,
            APIService: services.API,
        });
        expect(storageAccessDependencies).toEqual({
            API: services.API,
            setting: services.setting,
            fileProcessing: services.fileProcessing,
            vault: services.vault,
            appLifecycle: services.appLifecycle,
            storageEventManager: composition.instances.StorageEventManagerFSAPI,
            storageAccessManager: composition.instances.StorageAccessManager,
            vaultAccess: composition.instances.FileAccessFSAPI,
        });
        expect(databaseAccessDependencies).toEqual({
            events: services.events,
            API: services.API,
            database: services.database,
            path: services.path,
            storageAccess: modules.storageAccess,
            vault: services.vault,
        });
        expect(modules.vaultAccess).toBe(composition.instances.FileAccessFSAPI);
        expect(modules.storageEventManager).toBe(composition.instances.StorageEventManagerFSAPI);
        expect(composition.dependencies.ServiceFileHandler).toEqual({
            events: services.events,
            API: services.API,
            databaseFileAccess: modules.databaseFileAccess,
            conflict: services.conflict,
            setting: services.setting,
            fileProcessing: services.fileProcessing,
            vault: services.vault,
            path: services.path,
            replication: services.replication,
            storageAccess: modules.storageAccess,
            fileReflectionProvenance: expect.any(Object),
        });
        expect(composition.dependencies.ServiceRebuilder).toEqual({
            path: services.path,
            events: services.events,
            API: services.API,
            database: services.database,
            appLifecycle: services.appLifecycle,
            setting: services.setting,
            remote: services.remote,
            databaseEvents: services.databaseEvents,
            replication: services.replication,
            replicator: services.replicator,
            UI: services.UI,
            vault: services.vault,
            fileHandler: modules.fileHandler,
            fileProcessing: services.fileProcessing,
            storageAccess: modules.storageAccess,
            control: services.control,
        });
    });
});
