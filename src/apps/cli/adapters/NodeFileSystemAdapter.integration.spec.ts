import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeStorageAdapter, fsPromises, os, path } from "@vrtmrz/livesync-commonlib/node";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { StandardIo } from "@vrtmrz/livesync-commonlib/context";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { createDefaultCliSettings } from "@/apps/cli/cliSettingsDefaults";
import { runCommand } from "@/apps/cli/commands/runCommand";
import type { CLICommand, CLICommandContext } from "@/apps/cli/commands/types";
import { main, type CliCommandRunner } from "@/apps/cli/main";

type StoredFileSnapshot = {
    id: string;
    revision: string;
    path: string;
    size: number;
    children: string[];
    content: string;
};

describe("CLI NFC scan failure recovery", () => {
    const originalArgv = process.argv.slice();
    const originalExitCode = process.exitCode;
    const signalHandlers = new Map<"SIGINT" | "SIGTERM", Set<Parameters<typeof process.removeListener>[1]>>();
    let directory: string;
    let vaultPath: string;
    let settingsPath: string;
    let standardIo: StandardIo;

    afterEach(async () => {
        for (const [signal, originalHandlers] of signalHandlers) {
            for (const handler of process.listeners(signal)) {
                if (!originalHandlers.has(handler)) process.removeListener(signal, handler);
            }
        }
        signalHandlers.clear();
        process.argv = originalArgv.slice();
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
        if (directory) await fsPromises.rm(directory, { recursive: true, force: true });
    });

    async function start(command: CLICommand, runner: CliCommandRunner, exitCode: number) {
        process.exitCode = undefined;
        process.argv = [
            "node",
            "livesync-cli",
            path.join(directory, "db"),
            "--vault",
            vaultPath,
            "--settings",
            settingsPath,
            command,
        ];
        await expect(main(standardIo, runner)).rejects.toThrow(`__EXIT__:${exitCode}`);
    }

    async function snapshotFile(context: CLICommandContext, targetPath: string): Promise<StoredFileSnapshot> {
        for await (const doc of context.core.services.database.localDatabase.findAllNormalDocs({ conflicts: true }) || []) {
            if (stripAllPrefixes(doc.path) !== targetPath) continue;
            const file = await context.core.serviceModules.databaseFileAccess.fetch(targetPath as FilePathWithPrefix);
            if (!file || file.deleted) throw new Error(`Expected readable database content for ${targetPath}`);
            const body = file.body;
            if (body.type !== "text/plain") throw new Error(`Expected text database content for ${targetPath}`);
            return {
                id: doc._id,
                revision: doc._rev ?? "",
                path: doc.path,
                size: doc.size,
                children: [...doc.children],
                content: await body.text(),
            };
        }
        throw new Error(`Expected a stored Metadata document for ${targetPath}`);
    }

    it("does not accept a partially enumerated Vault as complete and keeps its PouchDB Metadata", async () => {
        directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "livesync-cli-nfc-scan-integration-"));
        vaultPath = path.join(directory, "vault");
        settingsPath = path.join(directory, "settings.json");
        const databasePath = path.join(directory, "db");
        const knownPath = "notes/known.md";
        const blockedPath = "notes/blocked/new.md";
        const knownContent = "stored before the failed inventory\n";
        const blockedContent = "available after recovery\n";

        await fsPromises.mkdir(path.join(vaultPath, "notes"), { recursive: true });
        await fsPromises.mkdir(databasePath);
        await fsPromises.writeFile(path.join(vaultPath, knownPath), knownContent);
        await fsPromises.writeFile(
            settingsPath,
            JSON.stringify({
                ...createDefaultCliSettings(),
                isConfigured: true,
                pathNormalizationVersion: 1,
            })
        );
        standardIo = {
            readStdin: vi.fn(async () => ""),
            prompt: vi.fn(async () => ""),
            writeStdout: vi.fn(),
            writeStderr: vi.fn(),
        };
        for (const signal of ["SIGINT", "SIGTERM"] as const) {
            signalHandlers.set(signal, new Set(process.listeners(signal)));
        }
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`__EXIT__:${code ?? 0}`);
        });

        let seeded: StoredFileSnapshot | undefined;
        const seedMirror = vi.fn<CliCommandRunner>(async (options, context) => {
            const result = await runCommand(options, context);
            seeded = await snapshotFile(context, knownPath);
            return result;
        });
        await start("mirror", seedMirror, 0);
        expect(seedMirror).toHaveBeenCalledOnce();
        expect(seeded).toMatchObject({ path: knownPath, content: knownContent });

        await fsPromises.mkdir(path.join(vaultPath, "notes", "blocked"));
        await fsPromises.writeFile(path.join(vaultPath, blockedPath), blockedContent);

        const scanFailure = Object.assign(new Error("Storage permission denied"), { code: "EACCES" });
        const directoryReads: string[] = [];
        const parentDirectoryEntries: string[] = [];
        // Retain the prototype implementation before the spy replaces it; invoke it with each real adapter below.
        const originalReadDirectory = Reflect.get(
            NodeStorageAdapter.prototype,
            "readDirectory"
        );
        const readDirectory = vi.spyOn(NodeStorageAdapter.prototype, "readDirectory").mockImplementation(
            async function (this: NodeStorageAdapter, relativePath) {
                directoryReads.push(relativePath);
                if (relativePath === "notes/blocked") throw scanFailure;
                const entries = await originalReadDirectory.call(this, relativePath);
                if (relativePath === "notes") {
                    parentDirectoryEntries.push(...(entries ?? []).map((entry) => entry.name));
                }
                return entries;
            }
        );
        const failedMirror = vi.fn<CliCommandRunner>(async (options, context) => await runCommand(options, context));
        try {
            await start("mirror", failedMirror, 1);
        } finally {
            readDirectory.mockRestore();
        }

        expect(failedMirror).not.toHaveBeenCalled();
        expect(directoryReads).toContain("");
        expect(directoryReads).toContain("notes");
        expect(directoryReads).toContain("notes/blocked");
        expect(parentDirectoryEntries).toContain("known.md");
        expect(parentDirectoryEntries).toContain("blocked");

        let afterFailure: StoredFileSnapshot | undefined;
        const inspectAfterFailure = vi.fn<CliCommandRunner>(async (options, context) => {
            const result = await runCommand(options, context);
            afterFailure = await snapshotFile(context, knownPath);
            return result;
        });
        await start("ls", inspectAfterFailure, 0);
        expect(afterFailure).toEqual(seeded);
        expect(await fsPromises.readFile(path.join(vaultPath, knownPath), "utf8")).toBe(knownContent);
        expect(await fsPromises.readFile(path.join(vaultPath, blockedPath), "utf8")).toBe(blockedContent);

        let recoveredKnown: StoredFileSnapshot | undefined;
        let recoveredNewFile: StoredFileSnapshot | undefined;
        const recoverMirror = vi.fn<CliCommandRunner>(async (options, context) => {
            const result = await runCommand(options, context);
            recoveredKnown = await snapshotFile(context, knownPath);
            recoveredNewFile = await snapshotFile(context, blockedPath);
            return result;
        });
        await start("mirror", recoverMirror, 0);
        expect(recoverMirror).toHaveBeenCalledOnce();
        expect(recoveredKnown).toEqual(seeded);
        expect(recoveredNewFile).toMatchObject({ path: blockedPath, content: blockedContent });
    });
});
