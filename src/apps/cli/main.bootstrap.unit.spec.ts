import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as chokidar from "chokidar";
import { path } from "@vrtmrz/livesync-commonlib/node";
import * as offlineScanner from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
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

vi.mock("@vrtmrz/livesync-commonlib/node", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/node")>();
    return { ...actual, path: { ...actual.path } };
});

vi.mock("chokidar", { spy: true });
vi.mock("@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner", { spy: true });

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
        vi.mocked(offlineScanner.useOfflineScanner).mockClear();
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

    async function start(
        command: CLICommand,
        runner: CliCommandRunner,
        exitCode = 1,
        force = false,
        writeSettings = false
    ) {
        process.exitCode = undefined;
        process.argv = [
            "node",
            "livesync-cli",
            directory,
            ...(force ? ["--force"] : []),
            ...(writeSettings ? ["--write-settings"] : []),
            "--vault",
            vaultPath,
            "--settings",
            settingsPath,
            command,
        ];
        // Daemon probes return false so the real core unloads without keeping a daemon alive.
        await expect(main(standardIo, runner)).rejects.toThrow(`__EXIT__:${exitCode}`);
    }

    it.each([
        { separator: "/", platform: "POSIX" },
        { separator: "\\", platform: "Windows" },
    ])("excludes internal Vault paths with the $platform host separator", async ({ separator }) => {
        const targets = [
            "headless-vault-livesync-v2/LOCK",
            ".livesync/settings.json",
            "notes/.private/secret.md",
            "notes/local.md",
        ];
        const observed: boolean[] = [];
        const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
            const originalSeparator = path.sep;
            try {
                Object.defineProperty(path, "sep", { value: separator });
                for (const target of targets) {
                    observed.push(await core.services.vault.isTargetFile(target as FilePathWithPrefix));
                }
            } finally {
                Object.defineProperty(path, "sep", { value: originalSeparator });
            }
            return false;
        });

        await start("ls", runner);

        expect(runner).toHaveBeenCalledOnce();
        expect(observed).toEqual([false, false, false, true]);
    });

    it("loads legacy device values and persists configuration through the service-owned store", async () => {
        const localStoragePath = join(directory, ".livesync", "runtime", "local-storage.json");
        await mkdir(join(directory, ".livesync", "runtime"), { recursive: true });
        await writeFile(localStoragePath, JSON.stringify({ ["__proto__"]: "legacy value" }));
        let legacyValue: string | null | undefined;
        const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
            legacyValue = await core.services.setting.deviceValues.getValue("__proto__");
            expect(core.services.config).toBe(core.services.setting.config);
            await core.services.config.setValue("bootstrap-probe", "config value");
            return false;
        });

        await start("ls", runner);

        expect(legacyValue).toBe("legacy value");
        const stored = JSON.parse(await readFile(localStoragePath, "utf-8")) as Record<string, string>;
        expect(Object.prototype.hasOwnProperty.call(stored, "__proto__")).toBe(true);
        expect(stored["__proto__"]).toBe("legacy value");
        expect(Object.values(stored)).toContain("config value");
    });

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

    it.each(["rebuild", "fetch"] as const)("does not scan or mirror legacy Vault files before %s", async (command) => {
        const storedPaths: string[] = [];
        const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
            for await (const doc of core.services.database.localDatabase.findAllNormalDocs()) {
                storedPaths.push(doc.path);
            }
            return false;
        });

        await start(command, runner, 1, true);

        expect(runner).toHaveBeenCalledOnce();
        expect(storedPaths).toEqual([]);
        expect(await readFile(join(vaultPath, "notes/local.md"), "utf-8")).toBe("local content");
        expect(vi.mocked(chokidar.watch)).not.toHaveBeenCalled();
    });

    it("registers the Rebuild scanner after readiness and makes its Vault scan available", async () => {
        const enumerate = vi.spyOn(ServiceFileAccessCLI.prototype, "getFiles");
        const useScanner = vi.mocked(offlineScanner.useOfflineScanner);

        let scansBeforeCommand = -1;
        let scannerRegistrationsBeforeCommand = -1;
        let storedPaths: string[] = [];
        const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
            scansBeforeCommand = enumerate.mock.calls.length;
            scannerRegistrationsBeforeCommand = useScanner.mock.calls.length;
            await core.services.vault.scanVault(true, true);
            for await (const doc of core.services.database.localDatabase.findAllNormalDocs()) {
                storedPaths.push(doc.path);
            }
            return false;
        });

        await start("rebuild", runner, 1, true);

        expect(useScanner).toHaveBeenCalledOnce();
        expect(scannerRegistrationsBeforeCommand).toBe(1);
        expect(scansBeforeCommand).toBe(0);
        expect(enumerate).toHaveBeenCalledOnce();
        expect(storedPaths).toEqual(["notes/local.md"]);
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

    it.each(["fetch", "rebuild"] as const)(
        "persists the selected database after %s without other command settings",
        async (command) => {
            const before = JSON.parse(await readFile(settingsPath, "utf-8"));
            const runner = vi.fn<CliCommandRunner>(async (_options, { core }) => {
                await core.services.setting.applyPartial({
                    additionalSuffixOfDatabaseName: "headless-app",
                    customChunkSize: before.customChunkSize + 10,
                });
                return true;
            });

            await start(command, runner, 0, true);

            const after = JSON.parse(await readFile(settingsPath, "utf-8"));
            expect(after.additionalSuffixOfDatabaseName).toBe("headless-app");
            expect(after.customChunkSize).toBe(before.customChunkSize);
        }
    );

    it.each(["suffix", "vault"] as const)("isolates persistent state by selected %s", async (selection) => {
        await start("ls", async (_options, { core }) => {
            await core.services.keyValueDB.kvDB.set("scope-probe", "original");
            await core.services.config.setValue("scope-probe", "original");
            return false;
        });
        if (selection === "suffix") {
            const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
            settings.additionalSuffixOfDatabaseName = "other";
            await writeFile(settingsPath, JSON.stringify(settings));
        } else {
            vaultPath = join(directory, "other-vault");
            await mkdir(vaultPath);
        }
        const observed: unknown[] = [];
        await start("ls", async (_options, { core }) => {
            observed.push(await core.services.keyValueDB.kvDB.get("scope-probe"));
            observed.push(await core.services.config.getValue("scope-probe"));
            return false;
        });
        expect(observed).toEqual([undefined, null]);
    });

    it.each(["sync", "daemon", "mirror", "put"] as const)(
        "blocks %s after failed reconstruction before command preparation",
        async (command) => {
            await start("fetch", async () => false, 1, true);
            const runner = vi.fn<CliCommandRunner>(async () => false);
            const ready = vi.spyOn(ControlService.prototype, "onReady");

            await start(command, runner);

            expect(runner).not.toHaveBeenCalled();
            expect(ready).not.toHaveBeenCalled();
        }
    );

    it("retains legacy queued work and blocks a scanner until explicit reconstruction succeeds", async () => {
        const legacy = join(directory, ".livesync/runtime/keyvalue-db.json");
        const legacyContents = JSON.stringify({
            "queued-files": ["notes/unique.md"],
            fileStatusMap: { "notes/local.md": 1 },
        });
        await mkdir(join(directory, ".livesync/runtime"), { recursive: true });
        await writeFile(legacy, legacyContents);
        const runner = vi.fn<CliCommandRunner>(async () => false);
        const scan = vi.spyOn(ServiceFileAccessCLI.prototype, "getFiles");

        await start("mirror", runner);
        expect(runner).not.toHaveBeenCalled();
        expect(scan).not.toHaveBeenCalled();
        expect(await readFile(legacy, "utf-8")).toBe(legacyContents);

        await start("fetch", async () => true, 0, true);
        const later = vi.fn<CliCommandRunner>(async () => false);
        await start("sync", later);
        expect(later).toHaveBeenCalledOnce();
        expect(await readFile(legacy, "utf-8")).toBe(legacyContents);
    });

    it("permits normal commands after reconstruction while preserving malformed legacy JSON", async () => {
        const legacy = join(directory, ".livesync/runtime/keyvalue-db.json");
        await mkdir(join(directory, ".livesync/runtime"), { recursive: true });
        await writeFile(legacy, '{"unfinished":');
        await start("fetch", async () => true, 0, true);
        const runner = vi.fn<CliCommandRunner>(async () => false);
        await start("sync", runner);
        expect(runner).toHaveBeenCalledOnce();
        expect(await readFile(legacy, "utf-8")).toBe('{"unfinished":');
    });

    it.each([
        ["kv", '{"unfinished":', "cannot be parsed"],
        ["snapshot", "[", "cannot be parsed"],
        ["kv", '{"queued-files":["unique.md"]}', "owner is unknown"],
        ["snapshot", '[{"path":"unique.md"}]', "owner is unknown"],
    ])("diagnoses unowned %s (%s) before readiness and ignores it after recovery", async (kind, contents, reason) => {
        const legacy =
            kind === "kv"
                ? join(directory, ".livesync/runtime/keyvalue-db.json")
                : join(vaultPath, ".livesync-snapshot.json");
        await mkdir(join(directory, ".livesync/runtime"), { recursive: true });
        await writeFile(legacy, contents);
        const messages = () => standardIo.writeStderr.mock.calls.flat().join("");
        const reader = vi.fn<CliCommandRunner>(async () => false);
        await start("ls", reader);
        expect(reader).toHaveBeenCalledOnce();
        expect(messages()).toContain(reason);
        expect(messages()).toContain(legacy);
        expect(messages()).toContain("inspection may continue");
        expect(messages().split("[Legacy state]")).toHaveLength(2);
        expect(standardIo.writeStdout.mock.calls.flat().join("")).not.toContain("[Legacy state]");

        standardIo.writeStderr.mockClear();
        const writer = vi.fn<CliCommandRunner>(async () => false);
        const ready = vi.spyOn(ControlService.prototype, "onReady");
        await start("mirror", writer);
        expect(writer).not.toHaveBeenCalled();
        expect(ready).not.toHaveBeenCalled();
        expect(messages()).toContain("stopped before scanning");
        expect(messages()).toContain(reason);
        expect(messages().split("[Legacy state]")).toHaveLength(2);
        ready.mockRestore();

        await start("fetch", async () => true, 0, true);
        standardIo.writeStderr.mockClear();
        const later = vi.fn<CliCommandRunner>(async () => false);
        await start("sync", later);
        expect(later).toHaveBeenCalledOnce();
        expect(messages()).not.toContain("[Legacy state]");
        expect(await readFile(legacy, "utf-8")).toBe(contents);
    });

    it("blocks read commands which request settings writes while reconstruction is interrupted", async () => {
        await start("fetch", async () => false, 1, true);
        const runner = vi.fn<CliCommandRunner>(async () => false);
        const load = vi.spyOn(ControlService.prototype, "onLoad");

        await start("ls", runner, 1, false, true);

        expect(runner).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
    });

    it("invalidates every Vault scope for the reset database and retains other database state", async () => {
        const originalVault = vaultPath;
        const otherVault = join(directory, "other-vault");
        await mkdir(otherVault);
        const select = async (suffix: string, selectedVault: string) => {
            vaultPath = selectedVault;
            const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
            settings.additionalSuffixOfDatabaseName = suffix;
            await writeFile(settingsPath, JSON.stringify(settings));
        };
        for (const [suffix, selectedVault] of [
            ["", originalVault],
            ["", otherVault],
            ["other", originalVault],
        ]) {
            await select(suffix, selectedVault);
            await start("ls", async (_options, { core }) => {
                await core.services.keyValueDB.kvDB.set("scope-probe", "stored");
                return false;
            });
        }
        await select("", originalVault);
        let reset: boolean | undefined;
        await start("ls", async (_options, { core }) => {
            reset = await core.services.database.resetDatabase();
            return false;
        });
        expect(reset).toBe(true);

        const observed: unknown[] = [];
        for (const [suffix, selectedVault] of [
            ["", originalVault],
            ["", otherVault],
            ["other", originalVault],
        ]) {
            await select(suffix, selectedVault);
            await start("ls", async (_options, { core }) => {
                observed.push(await core.services.keyValueDB.kvDB.get("scope-probe"));
                return false;
            });
        }
        expect(observed).toEqual([undefined, undefined, "stored"]);
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
