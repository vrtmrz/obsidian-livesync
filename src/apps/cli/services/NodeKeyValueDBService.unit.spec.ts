import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fs, os, path } from "@vrtmrz/livesync-commonlib/node";
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

describe("NodeKeyValueDBService persistence", () => {
    let directory: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-kv-"));
    });
    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    function compose(filePath: string | (() => string)) {
        const handlers: Record<string, () => Promise<boolean>> = {};
        const event = (name: string) => ({
            addHandler: (handler: () => Promise<boolean>) => {
                handlers[name] = handler;
            },
        });
        const dependencies = {
            appLifecycle: { onSettingLoaded: event("load") },
            databaseEvents: {
                onResetDatabase: event("reset"),
                onDatabaseInitialisation: event("initialise"),
                onUnloadDatabase: event("unload"),
                onCloseDatabase: event("close"),
            },
            vault: {},
        } as unknown as NodeKeyValueDBDependencies;
        return { service: new NodeKeyValueDBService(createServiceContext(), dependencies, filePath), handlers };
    }

    it("retargets existing SimpleStore handles after database selection and resets only the selected file", async () => {
        let selected = path.join(directory, "first.json");
        const { service, handlers } = compose(() => selected);
        const store = service.openSimpleStore("journal");
        expect(await handlers.load()).toBe(true);
        await store.set("checkpoint", new Set(["first"]));
        selected = path.join(directory, "second.json");
        expect(await handlers.initialise()).toBe(true);
        expect(await store.get("checkpoint")).toBeUndefined();
        await store.set("checkpoint", "second");
        expect(await handlers.reset()).toBe(true);
        expect(await store.get("checkpoint")).toBeUndefined();
        selected = path.join(directory, "first.json");
        expect(await handlers.initialise()).toBe(true);
        expect(await store.get("checkpoint")).toEqual(new Set(["first"]));
    });

    it("does not overwrite newer data when a stale handle closes", async () => {
        const filePath = path.join(directory, "state.json");
        const first = compose(filePath);
        await first.handlers.load();
        await first.service.kvDB.set("queued-files", ["original.md"]);
        const second = compose(filePath);
        await second.handlers.load();
        await first.service.kvDB.set("queued-files", ["unique-edit.md"]);
        await second.handlers.close();
        expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))["queued-files"]).toEqual(["unique-edit.md"]);
    });

    it.each(["{", "null", "[]"])("refuses corrupt state %s without replacing it", async (contents) => {
        const filePath = path.join(directory, "state.json");
        fs.writeFileSync(filePath, contents);
        const { service, handlers } = compose(filePath);
        expect(await handlers.load()).toBe(false);
        expect(() => service.kvDB).toThrow("not initialized");
        expect(fs.readFileSync(filePath, "utf-8")).toBe(contents);
    });
});
