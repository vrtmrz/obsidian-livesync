import { describe, expect, it, vi } from "vitest";
import type { Command } from "@/deps";
import { ModuleBasicMenu } from "./ModuleBasicMenu";

type RegisteredCommand = Command & {
    checkCallback?: (checking: boolean) => boolean | void;
};

function createFixture() {
    const commands: RegisteredCommand[] = [];
    const settings = {
        liveSync: false,
        useAdvancedMode: false,
        enableDebugTools: false,
    };
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn((command: RegisteredCommand) => {
                commands.push(command);
                return command;
            }),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        replication: {
            replicate: vi.fn(async () => undefined),
        },
        vault: {
            getActiveFilePath: vi.fn((): string | null => "note.md"),
            scanVault: vi.fn(async () => undefined),
        },
        control: {
            applySettings: vi.fn(async () => undefined),
        },
        setting: {
            saveSettingData: vi.fn(async () => undefined),
        },
        appLifecycle: {
            isSuspended: vi.fn(() => false),
            setSuspended: vi.fn(),
        },
        fileProcessing: {
            commitPendingFileEvents: vi.fn(async () => true),
        },
        UI: {
            promptCopyToClipboard: vi.fn(async (_title: string, _value: string) => true),
        },
        path: {
            path2id: vi.fn(async () => "f:note"),
        },
    };
    const core = {
        settings,
        _services: services,
        services,
        localDatabase: {
            getDBEntry: vi.fn(async () => false),
            localDatabase: {
                get: vi.fn(async () => ({
                    _id: "f:note",
                    _rev: "2-current",
                    _conflicts: [],
                    path: "note.md",
                    ctime: 100,
                    mtime: 200,
                    size: 12,
                    type: "plain",
                    children: ["h:private-chunk-id"],
                    eden: {},
                })),
            },
            getDBEntryMeta: vi.fn(async () => ({
                _id: "f:note",
                _rev: "2-current",
                _conflicts: [],
                path: "note.md",
                ctime: 100,
                mtime: 200,
                size: 12,
                type: "plain",
                datatype: "plain",
                data: "",
                children: ["h:private-chunk-id"],
                eden: {},
            })),
            allDocsRaw: vi.fn(async () => ({
                rows: [{ id: "h:private-chunk-id", key: "h:private-chunk-id", value: { rev: "1-chunk" } }],
            })),
        },
        storageAccess: {
            isExistsIncludeHidden: vi.fn(async () => true),
            statHidden: vi.fn(async () => ({ ctime: 100, mtime: 200, size: 12, type: "file" })),
        },
        replicator: {
            terminateSync: vi.fn(),
        },
    };
    const module = new ModuleBasicMenu(core as never);

    return {
        commands,
        core,
        module,
        services,
        settings,
        getCommand(id: string) {
            const command = commands.find((candidate) => candidate.id === id);
            expect(command, `command ${id}`).toBeDefined();
            return command!;
        },
    };
}

describe("ModuleBasicMenu command palette", () => {
    it("uses clear user-facing names without changing the established command IDs", async () => {
        const fixture = createFixture();

        await fixture.module._everyOnloadStart();

        expect(fixture.getCommand("livesync-replicate").name).toBe("Sync now");
        expect(fixture.getCommand("livesync-runbatch").name).toBe("Apply pending changes now");
    });

    it("keeps maintenance commands out of the normal palette", async () => {
        const fixture = createFixture();

        await fixture.module._everyOnloadStart();

        expect(fixture.getCommand("livesync-scan-files").checkCallback?.(true)).toBe(false);
        expect(fixture.getCommand("livesync-abortsync").checkCallback?.(true)).toBe(false);

        fixture.settings.useAdvancedMode = true;
        expect(fixture.getCommand("livesync-scan-files").checkCallback?.(true)).toBe(true);
        expect(fixture.getCommand("livesync-abortsync").checkCallback?.(true)).toBe(true);
    });

});
