import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as chokidar from "chokidar";
import { ControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/ControlService";
import {
    AutoAccepting,
    REMOTE_COUCHDB,
    REMOTE_P2P,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ServiceFileHandler } from "@/serviceModules/FileHandler";
import { ServiceFileAccessCLI } from "./serviceModules/ServiceFileAccessImpl";
import { runCommand } from "./commands/runCommand";
import { createDefaultCliSettings } from "./cliSettingsDefaults";
import { main, type CliCommandRunner } from "./main";
import { cloneSettings } from "./settingsPersistence";
import type { CLICommand } from "./commands/types";

vi.mock("chokidar", { spy: true });

function createStandardIoMock() {
    return {
        readStdin: vi.fn(async () => ""),
        prompt: vi.fn(async () => ""),
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
    };
}

describe("CLI database preparation", () => {
    const originalArgv = process.argv.slice();
    const originalExitCode = process.exitCode;
    let directory: string;
    let vaultPath: string;
    let settingsPath: string;
    let signalHandlers: Map<"SIGINT" | "SIGTERM", Set<NodeJS.SignalsListener>>;
    let standardIo: ReturnType<typeof createStandardIoMock>;

    beforeEach(async () => {
        vi.mocked(chokidar.watch).mockClear();
        directory = await mkdtemp(join(tmpdir(), "livesync-cli-bootstrap-"));
        vaultPath = join(directory, "vault");
        settingsPath = join(directory, "settings.json");
        await mkdir(join(vaultPath, "notes"), { recursive: true });
        await writeFile(join(vaultPath, "notes/local.md"), "local content");
        await writeFile(settingsPath, JSON.stringify({ ...createDefaultCliSettings(), isConfigured: true }));
        standardIo = createStandardIoMock();
        signalHandlers = new Map(
            (["SIGINT", "SIGTERM"] as const).map((signal) => [signal, new Set(process.listeners(signal))])
        );
        process.exitCode = undefined;
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`__EXIT__:${code ?? 0}`);
        });
    });

    afterEach(async () => {
        for (const [signal, originalHandlers] of signalHandlers) {
            for (const handler of process.listeners(signal)) {
                if (!originalHandlers.has(handler)) process.removeListener(signal, handler);
            }
        }
        process.argv = originalArgv.slice();
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
        await rm(directory, { recursive: true, force: true });
    });

    async function start(command: CLICommand, runner: CliCommandRunner, exitCode = 1) {
        process.argv = ["node", "livesync-cli", directory, "--vault", vaultPath, "--settings", settingsPath, command];
        // Daemon probes return false so the real core unloads without keeping a daemon alive.
        await expect(main(standardIo, runner)).rejects.toThrow(`__EXIT__:${exitCode}`);
    }

    it.each([REMOTE_P2P, REMOTE_COUCHDB])(
        "restores configured P2P automation before the host connects (%s)",
        async (remoteType) => {
            const p2pSettings = {
                P2P_Enabled: true,
                P2P_AutoAccepting: AutoAccepting.ALL,
                P2P_AutoStart: true,
                P2P_AutoBroadcast: true,
                P2P_AutoSyncPeers: "Desktop,android",
                P2P_AutoWatchPeers: "Desktop,android",
            };
            await writeFile(
                settingsPath,
                JSON.stringify({
                    ...createDefaultCliSettings(),
                    isConfigured: true,
                    remoteType,
                    liveSync: true,
                    periodicReplication: true,
                    syncOnSave: true,
                    ...p2pSettings,
                })
            );
            const savedSettings = await readFile(settingsPath, "utf-8");
            let settingsBeforeHost: ObsidianLiveSyncSettings | undefined;
            let settingsAtConnect: ObsidianLiveSyncSettings | undefined;
            const connect = vi.fn();
            const runner = vi.fn<CliCommandRunner>(async (options, context) => {
                settingsBeforeHost = cloneSettings(context.core.services.setting.currentSettings());
                connect.mockImplementation(async () => {
                    settingsAtConnect = cloneSettings(context.core.services.setting.currentSettings());
                    throw new Error("Host connection probe complete");
                });
                return runCommand(options, {
                    ...context,
                    p2pReplicator: {
                        ...context.p2pReplicator!,
                        transportLifecycle: { isConnected: false, connect, disconnect: vi.fn() },
                    },
                });
            });

            await start("p2p-host", runner);

            expect(settingsBeforeHost).toMatchObject({
                P2P_AutoBroadcast: false,
                P2P_AutoSyncPeers: "",
                P2P_AutoWatchPeers: "",
            });
            expect(connect).toHaveBeenCalledOnce();
            expect(settingsAtConnect).toMatchObject(p2pSettings);
            expect(settingsAtConnect).toMatchObject({ liveSync: false, periodicReplication: false, syncOnSave: false });
            expect(await readFile(settingsPath, "utf-8")).toBe(savedSettings);
        }
    );

    it.each(["ls", "put", "remote-set", "p2p-peers", "p2p-sync"] as const)(
        "keeps automatic P2P work suspended for %s",
        async (command) => {
            await writeFile(
                settingsPath,
                JSON.stringify({
                    ...createDefaultCliSettings(),
                    isConfigured: true,
                    remoteType: REMOTE_P2P,
                    P2P_Enabled: true,
                    P2P_AutoAccepting: AutoAccepting.ALL,
                    P2P_AutoStart: true,
                    P2P_AutoBroadcast: true,
                    P2P_AutoSyncPeers: "Desktop",
                    P2P_AutoWatchPeers: "Desktop",
                })
            );
            const savedSettings = await readFile(settingsPath, "utf-8");
            let settingsAtCommand: ObsidianLiveSyncSettings | undefined;
            const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
                settingsAtCommand = cloneSettings(core.services.setting.currentSettings());
                return false;
            });

            await start(command, runner);

            expect(runner).toHaveBeenCalledOnce();
            expect(settingsAtCommand).toMatchObject({
                P2P_Enabled: true,
                P2P_AutoAccepting: AutoAccepting.NONE,
                P2P_AutoStart: false,
                P2P_AutoBroadcast: false,
                P2P_AutoSyncPeers: "",
                P2P_AutoWatchPeers: "",
            });
            expect(await readFile(settingsPath, "utf-8")).toBe(savedSettings);
        }
    );

    it.each([
        { command: "daemon" as const, suspendFileWatching: false },
        { command: "mirror" as const, suspendFileWatching: false },
        { command: "mirror" as const, suspendFileWatching: true },
    ])(
        "prepares the Vault before $command (watching suspended: $suspendFileWatching)",
        async ({ command, suspendFileWatching }) => {
            await writeFile(
                settingsPath,
                JSON.stringify({ ...createDefaultCliSettings(), isConfigured: true, suspendFileWatching })
            );
            await mkdir(join(vaultPath, ".livesync"));
            await writeFile(join(vaultPath, ".livesync/ignore"), "*.tmp\n");
            await writeFile(join(vaultPath, "notes/ignored.tmp"), "ignored");
            const storedPaths: string[] = [];
            let content: string | undefined;
            const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
                for await (const doc of core.services.database.localDatabase.findAllNormalDocs()) {
                    storedPaths.push(doc.path);
                }
                const file = await core.serviceModules.databaseFileAccess.fetch("notes/local.md" as FilePathWithPrefix);
                content = file ? await file.body.text() : undefined;
                return false;
            });

            await start(command, runner);

            expect(runner).toHaveBeenCalledOnce();
            expect(storedPaths).toEqual(["notes/local.md"]);
            expect(content).toBe("local content");
            expect(await readFile(join(vaultPath, "notes/local.md"), "utf-8")).toBe("local content");
        }
    );

    it("retains filesystem creation time in database Metadata after an in-place edit", async (context) => {
        const note = join(vaultPath, "notes/local.md");
        const initial = await stat(note);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await appendFile(note, "\nedit");
        const edited = await stat(note);
        if (
            initial.birthtimeMs <= 0 ||
            edited.birthtimeMs !== initial.birthtimeMs ||
            Math.floor(edited.ctimeMs) <= Math.floor(initial.birthtimeMs)
        ) {
            context.skip();
        }

        const observed: { before?: number; after?: number; content?: string; stored?: boolean } = {};
        const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
            const filePath = "notes/local.md" as FilePathWithPrefix;
            const before = await core.serviceModules.databaseFileAccess.fetch(filePath);
            if (before) observed.before = before.stat.ctime;
            await appendFile(note, "\nsecond edit");
            observed.stored = await core.serviceModules.fileHandler.storeFileToDB(filePath, true);
            const after = await core.serviceModules.databaseFileAccess.fetch(filePath);
            if (after) {
                observed.after = after.stat.ctime;
                observed.content = await after.body.text();
            }
            return false;
        });

        await start("daemon", runner);
        expect(runner).toHaveBeenCalledOnce();
        expect(observed).toEqual({
            before: Math.floor(initial.birthtimeMs),
            after: Math.floor(initial.birthtimeMs),
            content: "local content\nedit\nsecond edit",
            stored: true,
        });
    });

    it("runs the mirror scan once and exits without starting file watching", async () => {
        const enumerate = vi.spyOn(ServiceFileAccessCLI.prototype, "getFiles");
        const watch = vi.mocked(chokidar.watch);
        const runner = vi.fn<CliCommandRunner>(runCommand);

        await start("mirror", runner, 0);

        expect(runner).toHaveBeenCalledOnce();
        expect(enumerate).toHaveBeenCalledOnce();
        expect(watch).not.toHaveBeenCalled();
    });

    it.each([
        { command: "daemon" as const, commandRuns: true },
        { command: "mirror" as const, commandRuns: false },
    ])("handles an individual file failure during $command preparation", async ({ command, commandRuns }) => {
        const store = vi
            .spyOn(ServiceFileHandler.prototype, "storeFileToDB")
            .mockRejectedValue(new Error("file failed"));
        const unload = vi.spyOn(ControlService.prototype, "onUnload");
        const runner = vi.fn<CliCommandRunner>(async () => false);

        await start(command, runner);

        expect(store).toHaveBeenCalledOnce();
        expect(runner).toHaveBeenCalledTimes(commandRuns ? 1 : 0);
        expect(unload).toHaveBeenCalledOnce();
        expect(await readFile(join(vaultPath, "notes/local.md"), "utf-8")).toBe("local content");
    });

    it("does not import vault files for standalone database commands", async () => {
        const storedPaths: string[] = [];
        const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
            for await (const doc of core.services.database.localDatabase.findAllNormalDocs()) {
                storedPaths.push(doc.path);
            }
            return false;
        });

        await start("ls", runner);

        expect(runner).toHaveBeenCalledOnce();
        expect(storedPaths).toEqual([]);
    });

    it.each(["daemon", "p2p-host"] as const)(
        "unloads without starting %s when database preparation fails",
        async (command) => {
            vi.spyOn(ControlService.prototype, "onReady").mockResolvedValue(false);
            const unload = vi.spyOn(ControlService.prototype, "onUnload");
            const runner = vi.fn<CliCommandRunner>(async () => false);
            const settingsBefore = await readFile(settingsPath, "utf-8");

            await start(command, runner);

            expect(runner).not.toHaveBeenCalled();
            expect(unload).toHaveBeenCalledOnce();
            expect(unload.mock.invocationCallOrder[0]).toBeLessThan(
                vi.mocked(process.exit).mock.invocationCallOrder[0]
            );
            expect(process.exit).toHaveBeenCalledWith(1);
            expect(await readFile(settingsPath, "utf-8")).toBe(settingsBefore);
        }
    );

    it("stops the daemon when the startup scanner refuses a suspended Vault scan", async () => {
        await writeFile(
            settingsPath,
            JSON.stringify({ ...createDefaultCliSettings(), isConfigured: true, suspendFileWatching: true })
        );
        const unload = vi.spyOn(ControlService.prototype, "onUnload");
        const runner = vi.fn<CliCommandRunner>(async () => false);

        await start("daemon", runner);

        expect(runner).not.toHaveBeenCalled();
        expect(unload).toHaveBeenCalledOnce();
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("unloads when database preparation throws", async () => {
        const ready = vi.spyOn(ControlService.prototype, "onReady").mockRejectedValue(new Error("scan failed"));
        const unload = vi.spyOn(ControlService.prototype, "onUnload");
        const runner = vi.fn<CliCommandRunner>(async () => false);

        try {
            await start("daemon", runner);

            expect(runner).not.toHaveBeenCalled();
            expect(unload).toHaveBeenCalledOnce();
            expect(standardIo.writeStderr.mock.calls.flat().join("")).toContain("scan failed");
        } finally {
            const control = ready.mock.contexts[0];
            if (unload.mock.calls.length === 0 && control instanceof ControlService) await control.onUnload();
        }
    });
});
