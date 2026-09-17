import { describe, expect, it, vi } from "vitest";

vi.mock("@/common/events.ts", () => ({
    EVENT_SETTING_SAVED: "setting-saved",
    eventHub: {
        onEvent: vi.fn(() => vi.fn()),
    },
}));

import { eventHub } from "@/common/events.ts";
import { useHiddenFileSyncCommands } from "./useHiddenFileSyncCommands.ts";

type Handler = () => Promise<boolean> | boolean;

function handlerRegistry() {
    const handlers: Handler[] = [];
    return {
        addHandler: vi.fn((handler: Handler) => {
            handlers.push(handler);
            return () => {
                const index = handlers.indexOf(handler);
                if (index >= 0) handlers.splice(index, 1);
            };
        }),
        handlers,
    };
}

function createFixture() {
    const commands: Array<{
        id: string;
        checkCallback?: (checking: boolean) => boolean | void;
    }> = [];
    const onLoaded = handlerRegistry();
    const onUnload = handlerRegistry();
    const operations = {
        isManualCommandAvailable: vi.fn(() => true),
        initialiseInternalFileSync: vi.fn(async () => undefined),
        scanAllStorageChanges: vi.fn(async () => undefined),
        scanAllDatabaseChanges: vi.fn(async () => undefined),
        applyOfflineChanges: vi.fn(async () => undefined),
        updateSettingCache: vi.fn(),
    };
    const host = {
        services: {
            API: {
                addCommand: vi.fn((command) => commands.push(command)),
            },
            appLifecycle: { onLoaded, onUnload },
        },
    };

    useHiddenFileSyncCommands(host as never, operations);
    return { commands, host, onLoaded, onUnload, operations };
}

describe("useHiddenFileSyncCommands", () => {
    it("registers the established commands after loading and delegates their actions", async () => {
        const { commands, onLoaded, operations } = createFixture();

        await onLoaded.handlers[0]!();
        expect(commands.map(({ id }) => id)).toEqual([
            "livesync-sync-internal",
            "livesync-scaninternal-storage",
            "livesync-scaninternal-database",
            "livesync-internal-scan-offline-changes",
        ]);

        for (const command of commands) {
            expect(command.checkCallback?.(true)).toBe(true);
            command.checkCallback?.(false);
        }
        expect(operations.initialiseInternalFileSync).toHaveBeenCalledWith("safe", true);
        expect(operations.scanAllStorageChanges).toHaveBeenCalledWith(true);
        expect(operations.scanAllDatabaseChanges).toHaveBeenCalledWith(true);
        expect(operations.applyOfflineChanges).toHaveBeenCalledWith(true);
    });

    it("short-circuits every command through the operation view", async () => {
        const { commands, onLoaded, operations } = createFixture();
        operations.isManualCommandAvailable.mockReturnValue(false);

        await onLoaded.handlers[0]!();

        for (const command of commands) {
            expect(command.checkCallback?.(true)).toBe(false);
            expect(command.checkCallback?.(false)).toBe(false);
        }
        expect(operations.initialiseInternalFileSync).not.toHaveBeenCalled();
        expect(operations.scanAllStorageChanges).not.toHaveBeenCalled();
        expect(operations.scanAllDatabaseChanges).not.toHaveBeenCalled();
        expect(operations.applyOfflineChanges).not.toHaveBeenCalled();
    });

    it("owns and releases the settings event subscription", async () => {
        vi.mocked(eventHub.onEvent).mockClear();
        const { onLoaded, onUnload, operations } = createFixture();

        await onLoaded.handlers[0]!();
        const [, listener] = vi.mocked(eventHub.onEvent).mock.calls[0]!;
        const eventDisposer = vi.mocked(eventHub.onEvent).mock.results[0]!.value;
        listener(undefined as never);
        expect(operations.updateSettingCache).toHaveBeenCalledOnce();

        await onUnload.handlers[0]!();
        expect(eventDisposer).toHaveBeenCalledOnce();
        expect(onLoaded.handlers).toHaveLength(0);
    });
});
