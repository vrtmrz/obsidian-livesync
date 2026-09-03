import { describe, expect, it, vi } from "vitest";
import type { ICommandCompat } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import {
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";
import { copyFileDatabaseInfo } from "./fileDatabaseInfo";
import { useBasicCommandsFeature, type BasicCommandsHost } from "./basicCommands";

vi.mock("./fileDatabaseInfo", () => ({
    copyFileDatabaseInfo: vi.fn(async () => true),
}));

type RegisteredCommand = ICommandCompat & {
    checkCallback?: (checking: boolean) => boolean | void;
};

function createFixture() {
    const commands: RegisteredCommand[] = [];
    const initialiseHandlers: Array<() => Promise<unknown>> = [];
    const settings = {
        liveSync: false,
        useAdvancedMode: false,
    };
    const api = {
        addCommand: vi.fn((command: RegisteredCommand) => {
            commands.push(command);
            return command;
        }),
        addLog: vi.fn(),
    };
    const services = {
        API: api,
        appLifecycle: {
            onInitialise: {
                addHandler: vi.fn((handler: () => Promise<unknown>) => {
                    initialiseHandlers.push(handler);
                }),
            },
            isSuspended: vi.fn(() => false),
            setSuspended: vi.fn(),
        },
        control: {
            applySettings: vi.fn(async () => undefined),
        },
        database: {
            localDatabase: { databaseMarker: "local" },
        },
        fileProcessing: {
            commitPendingFileEvents: vi.fn(async () => true),
        },
        path: {
            path2id: vi.fn(async () => "f:note"),
        },
        replication: {
            replicateUserInitiated: vi.fn(async () => ({ status: "completed" as const })),
            stopActiveTransfer: vi.fn(async () => ({ status: "completed" as const })),
        },
        setting: {
            currentSettings: vi.fn(() => settings),
            saveSettingData: vi.fn(async () => undefined),
        },
        UI: {
            promptCopyToClipboard: vi.fn(async () => true),
        },
        vault: {
            getActiveFilePath: vi.fn((): string | undefined => "note.md"),
            scanVault: vi.fn(async () => true),
        },
    };
    const serviceModules = {
        storageAccess: {
            isExistsIncludeHidden: vi.fn(async () => true),
            statHidden: vi.fn(async () => ({ ctime: 0, mtime: 0, size: 0, type: "file" })),
        },
    };
    const host = { services, serviceModules } as unknown as BasicCommandsHost;

    return {
        api,
        commands,
        host,
        initialiseHandlers,
        services,
        serviceModules,
        settings,
        getCommand(id: string) {
            const command = commands.find((candidate) => candidate.id === id);
            expect(command, `command ${id}`).toBeDefined();
            return command!;
        },
    };
}

async function initialise(fixture: ReturnType<typeof createFixture>) {
    useBasicCommandsFeature(fixture.host);
    expect(fixture.initialiseHandlers).toHaveLength(1);
    expect(fixture.commands).toHaveLength(0);
    await fixture.initialiseHandlers[0]?.();
}

describe("useBasicCommandsFeature", () => {
    it("registers all established commands only when initialisation runs", async () => {
        const fixture = createFixture();

        useBasicCommandsFeature(fixture.host);

        expect(fixture.services.appLifecycle.onInitialise.addHandler).toHaveBeenCalledOnce();
        expect(fixture.api.addCommand).not.toHaveBeenCalled();

        await fixture.initialiseHandlers[0]?.();

        expect(fixture.commands.map(({ id }) => id)).toEqual([
            "livesync-replicate",
            "livesync-dump",
            "livesync-toggle",
            "livesync-suspendall",
            "livesync-scan-files",
            "livesync-runbatch",
            "livesync-abortsync",
        ]);
        expect(fixture.getCommand("livesync-replicate").name).toBe("Sync now");
        expect(fixture.getCommand("livesync-dump").name).toBe("Copy database information for the active file");
        expect(fixture.getCommand("livesync-toggle").name).toBe("Toggle LiveSync");
        expect(fixture.getCommand("livesync-suspendall").name).toBe("Toggle All Sync.");
        expect(fixture.getCommand("livesync-scan-files").name).toBe("Scan storage and database again");
        expect(fixture.getCommand("livesync-runbatch").name).toBe("Apply pending changes now");
        expect(fixture.getCommand("livesync-abortsync").name).toBe("Abort synchronization immediately");
    });

    it("retains the manual replication authority and quiet progress presentation", async () => {
        const fixture = createFixture();
        await initialise(fixture);

        await fixture.getCommand("livesync-replicate").callback?.();

        expect(fixture.services.replication.replicateUserInitiated).toHaveBeenCalledWith({
            trigger: "manual",
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
    });

    it("toggles LiveSync and persists the updated setting", async () => {
        const fixture = createFixture();
        await initialise(fixture);

        await fixture.getCommand("livesync-toggle").callback?.();

        expect(fixture.settings.liveSync).toBe(true);
        expect(fixture.api.addLog).toHaveBeenCalledWith("LiveSync Enabled.", expect.anything(), "");
        expect(fixture.services.control.applySettings).toHaveBeenCalledOnce();
        expect(fixture.services.setting.saveSettingData).toHaveBeenCalledOnce();
        expect(fixture.services.control.applySettings.mock.invocationCallOrder[0]).toBeLessThan(
            fixture.services.setting.saveSettingData.mock.invocationCallOrder[0]
        );

        await fixture.getCommand("livesync-toggle").callback?.();

        expect(fixture.settings.liveSync).toBe(false);
        expect(fixture.api.addLog).toHaveBeenCalledWith("LiveSync Disabled.", expect.anything(), "");
    });

    it("toggles all synchronisation through the app lifecycle and persists it", async () => {
        const fixture = createFixture();
        await initialise(fixture);

        await fixture.getCommand("livesync-suspendall").callback?.();

        expect(fixture.services.appLifecycle.setSuspended).toHaveBeenCalledWith(true);
        expect(fixture.api.addLog).toHaveBeenCalledWith("Self-hosted LiveSync suspended", expect.anything(), "");
        expect(fixture.services.control.applySettings).toHaveBeenCalledOnce();
        expect(fixture.services.setting.saveSettingData).toHaveBeenCalledOnce();
        expect(fixture.services.control.applySettings.mock.invocationCallOrder[0]).toBeLessThan(
            fixture.services.setting.saveSettingData.mock.invocationCallOrder[0]
        );

        fixture.services.appLifecycle.isSuspended.mockReturnValue(true);
        await fixture.getCommand("livesync-suspendall").callback?.();

        expect(fixture.services.appLifecycle.setSuspended).toHaveBeenLastCalledWith(false);
        expect(fixture.api.addLog).toHaveBeenCalledWith("Self-hosted LiveSync resumed", expect.anything(), "");
    });

    it("keeps advanced maintenance checks gated and invokes their exact actions", async () => {
        const fixture = createFixture();
        await initialise(fixture);

        expect(fixture.getCommand("livesync-scan-files").checkCallback?.(true)).toBe(false);
        expect(fixture.getCommand("livesync-abortsync").checkCallback?.(true)).toBe(false);

        fixture.settings.useAdvancedMode = true;
        expect(fixture.getCommand("livesync-scan-files").checkCallback?.(true)).toBe(true);
        expect(fixture.getCommand("livesync-abortsync").checkCallback?.(true)).toBe(true);
        expect(fixture.services.vault.scanVault).not.toHaveBeenCalled();
        expect(fixture.services.replication.stopActiveTransfer).not.toHaveBeenCalled();

        fixture.getCommand("livesync-scan-files").checkCallback?.(false);
        fixture.getCommand("livesync-abortsync").checkCallback?.(false);
        await vi.waitFor(() => {
            expect(fixture.services.vault.scanVault).toHaveBeenCalledWith(true);
            expect(fixture.services.replication.stopActiveTransfer).toHaveBeenCalledOnce();
        });
    });

    it("copies active-file database information through a narrow structural adapter", async () => {
        const fixture = createFixture();
        await initialise(fixture);

        const dump = fixture.getCommand("livesync-dump");
        vi.mocked(copyFileDatabaseInfo).mockClear();
        expect(dump.checkCallback?.(true)).toBe(true);
        expect(copyFileDatabaseInfo).not.toHaveBeenCalled();
        dump.checkCallback?.(false);

        await vi.waitFor(() => expect(copyFileDatabaseInfo).toHaveBeenCalledOnce());
        const [adapter, path] = vi.mocked(copyFileDatabaseInfo).mock.calls[0] ?? [];
        expect(path).toBe("note.md");
        expect(adapter).toEqual({
            localDatabase: fixture.services.database.localDatabase,
            services: {
                path: fixture.services.path,
                UI: fixture.services.UI,
            },
            settings: fixture.settings,
            storageAccess: fixture.serviceModules.storageAccess,
        });
        expect(adapter).not.toBe(fixture.host);
    });

    it("commits pending file events from the batch command", async () => {
        const fixture = createFixture();
        await initialise(fixture);

        await fixture.getCommand("livesync-runbatch").callback?.();

        expect(fixture.services.fileProcessing.commitPendingFileEvents).toHaveBeenCalledOnce();
    });

    it("keeps the active-file report unavailable without an active file", async () => {
        const fixture = createFixture();
        fixture.services.vault.getActiveFilePath.mockReturnValue(undefined);
        await initialise(fixture);

        expect(fixture.getCommand("livesync-dump").checkCallback?.(true)).toBe(false);
    });
});
