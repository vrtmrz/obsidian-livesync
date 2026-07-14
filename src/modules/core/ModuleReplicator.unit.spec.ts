import { describe, expect, it, vi } from "vitest";
import { ModuleReplicator } from "./ModuleReplicator";

describe("ModuleReplicator", () => {
    it("refreshes the remote Security Seed before replication", async () => {
        const ensurePBKDF2Salt = vi.fn(async () => true);
        let beforeReplicate: ((showMessage: boolean) => Promise<boolean>) | undefined;
        const addHandler = vi.fn((handler: (showMessage: boolean) => Promise<boolean>, priority?: number) => {
            if (priority === 20) {
                beforeReplicate = handler;
            }
        });
        const services = {
            API: { isOnline: true },
            replicator: {
                onReplicatorInitialised: { addHandler: vi.fn() },
                getActiveReplicator: () => ({ ensurePBKDF2Salt }),
            },
            setting: { currentSettings: () => ({}) },
            databaseEvents: { onDatabaseInitialised: { addHandler: vi.fn() } },
            appLifecycle: { onSettingLoaded: { addHandler: vi.fn() } },
            replication: {
                parseSynchroniseResult: { addHandler: vi.fn() },
                onBeforeReplicate: { addHandler },
                onReplicationFailed: { addHandler: vi.fn() },
            },
        };
        const module = {
            _unresolvedErrorManager: {
                showError: vi.fn(),
                clearError: vi.fn(),
            },
            _onReplicatorInitialised: vi.fn(),
            _everyOnDatabaseInitialized: vi.fn(),
            _everyOnloadAfterLoadSettings: vi.fn(),
            _parseReplicationResult: vi.fn(),
            _everyBeforeReplicate: vi.fn(),
            onReplicationFailed: vi.fn(),
        };

        ModuleReplicator.prototype.onBindFunction.call(module, {} as never, services as never);
        expect(beforeReplicate).toBeDefined();

        await beforeReplicate!(false);

        expect(ensurePBKDF2Salt).toHaveBeenCalledWith({}, false, false);
    });
});
