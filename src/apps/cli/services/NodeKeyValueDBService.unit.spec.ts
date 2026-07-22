import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import type { NodeKeyValueDBDependencies } from "./NodeKeyValueDBService";
import { NodeKeyValueDBService } from "./NodeKeyValueDBService";

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
});
