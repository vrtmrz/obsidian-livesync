import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { fsPromises as fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import type { NodeKeyValueDBDependencies } from "./NodeKeyValueDBService";
import { NodeKeyValueDBService } from "./NodeKeyValueDBService";

function createInitialisableDependencies(): {
    dependencies: NodeKeyValueDBDependencies;
    initialise: () => Promise<boolean>;
} {
    let initialise: (() => Promise<boolean>) | undefined;
    const dependencies = {
        appLifecycle: {
            onSettingLoaded: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    initialise = handler;
                }),
            },
        },
        databaseEvents: {
            onResetDatabase: { addHandler: vi.fn() },
            onDatabaseInitialisation: { addHandler: vi.fn() },
            onUnloadDatabase: { addHandler: vi.fn() },
            onCloseDatabase: { addHandler: vi.fn() },
        },
        vault: {},
    } as unknown as NodeKeyValueDBDependencies;
    return {
        dependencies,
        initialise: async () => {
            if (!initialise) throw new Error("Initialisation handler was not registered");
            return await initialise();
        },
    };
}

describe("NodeKeyValueDBService.openSimpleStore", () => {
    it("creates a namespaced store handle before the backing database is initialised", () => {
        const dependencies = {
            appLifecycle: { onSettingLoaded: { addHandler: vi.fn() } },
            databaseEvents: {
                onResetDatabase: { addHandler: vi.fn() },
                onDatabaseInitialisation: { addHandler: vi.fn() },
                onUnloadDatabase: { addHandler: vi.fn() },
                onCloseDatabase: { addHandler: vi.fn() },
            },
            vault: {},
        } as unknown as NodeKeyValueDBDependencies;
        const service = new NodeKeyValueDBService(
            createServiceContext(),
            dependencies,
            "/tmp/obsidian-livesync-node-kv-handle-test.json"
        );

        expect(() => service.openSimpleStore("early-composition")).not.toThrow();
    });

    it("fails store operations promptly instead of waiting for lifecycle initialisation", async () => {
        const dependencies = {
            appLifecycle: { onSettingLoaded: { addHandler: vi.fn() } },
            databaseEvents: {
                onResetDatabase: { addHandler: vi.fn() },
                onDatabaseInitialisation: { addHandler: vi.fn() },
                onUnloadDatabase: { addHandler: vi.fn() },
                onCloseDatabase: { addHandler: vi.fn() },
            },
            vault: {},
        } as unknown as NodeKeyValueDBDependencies;
        const service = new NodeKeyValueDBService(
            createServiceContext(),
            dependencies,
            "/tmp/obsidian-livesync-node-kv-uninitialised-test.json"
        );
        const store = service.openSimpleStore("early-composition");

        await expect(store.get("key")).rejects.toThrow("KeyValueDB is not initialized yet");
    });

    it("preserves bigint values used by Adaptive Journal writer state", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-node-kv-bigint-"));
        const filePath = path.join(tempDir, "keyvalue-db.json");
        const writerState = {
            writerEpoch: 9007199254740993n,
            nested: [0n, { sequence: 18446744073709551615n }],
        };

        try {
            const firstLifecycle = createInitialisableDependencies();
            const first = new NodeKeyValueDBService(createServiceContext(), firstLifecycle.dependencies, filePath);
            await expect(firstLifecycle.initialise()).resolves.toBe(true);
            await first.openSimpleStore("adaptive").set("writer-state", writerState);

            const secondLifecycle = createInitialisableDependencies();
            const second = new NodeKeyValueDBService(createServiceContext(), secondLifecycle.dependencies, filePath);
            await expect(secondLifecycle.initialise()).resolves.toBe(true);

            await expect(second.openSimpleStore("adaptive").get("writer-state")).resolves.toEqual(writerState);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
