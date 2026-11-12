import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { IStorageEventWatchHandlers } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import { UnicodeResolvingNodeStorageAdapter } from "@vrtmrz/livesync-commonlib/node";
import { CLIFileNameSource } from "@/apps/cli/storage/CLIFileNameSource";
import { IgnoreRules } from "@/apps/cli/serviceModules/IgnoreRules";
import { CLIStorageEventManagerAdapter } from "./CLIStorageEventManagerAdapter";
import { NodeTypeGuardAdapter } from "@/apps/cli/adapters/NodeTypeGuardAdapter";

const run = promisify(execFile);

type WatchEvent = {
    type: "create" | "change" | "delete";
    path: string;
    folder: boolean;
};

function makeHandlers(events: WatchEvent[], onRename: () => void = () => undefined): IStorageEventWatchHandlers {
    const typeGuard = new NodeTypeGuardAdapter();
    const record = (type: WatchEvent["type"], file: unknown) => {
        if (!typeGuard.isFile(file) && !typeGuard.isFolder(file)) {
            throw new TypeError("Expected a CLI file or folder event");
        }
        events.push({ type, path: file.path, folder: typeGuard.isFolder(file) });
    };
    return {
        onCreate: (file) => record("create", file),
        onChange: (file) => record("change", file),
        onDelete: (file) => record("delete", file),
        onRename,
        onRaw: () => undefined,
    };
}

function makeIndexedAdapter(root: string, ignoreRules?: IgnoreRules, reportDiagnostic?: CliDiagnosticReporter) {
    const storage = new UnicodeResolvingNodeStorageAdapter(root);
    const source = new CLIFileNameSource(
        storage,
        () => ({ pathNormalizationVersion: 0, handleFilenameCaseSensitive: true }),
        { basePath: root, ignoreRules, reportDiagnostic }
    );
    return {
        source,
        storage,
        adapter: new CLIStorageEventManagerAdapter(
            root,
            ignoreRules,
            true,
            reportDiagnostic,
            undefined,
            undefined,
            source
        ),
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) return false;
        await delay(25);
    }
    return true;
}

const directoryFirstWriter = `
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];

for (let directoryIndex = 0; directoryIndex < 40; directoryIndex++) {
    fs.mkdirSync(path.join(root, "book-" + directoryIndex));
}

for (let directoryIndex = 0; directoryIndex < 40; directoryIndex++) {
    const directory = path.join(root, "book-" + directoryIndex);
    for (let fileIndex = 0; fileIndex < 10; fileIndex++) {
        const name = "image-" + fileIndex + ".png";
        const temporary = path.join(directory, "." + name + ".tmp");
        const target = path.join(directory, name);
        fs.writeFileSync(temporary, "payload:" + directoryIndex + ":" + fileIndex);
        fs.renameSync(temporary, target);
    }
}
`;

describe("CLI filesystem watcher with a real filesystem", () => {
    it.each([
        { name: "an ordinary Vault", parent: "notes", vault: "vault", alias: false },
        {
            name: "an ordinary Vault through a symlink",
            parent: "notes",
            vault: "vault",
            alias: true,
        },
        {
            name: "a hidden-parent Vault by physical path",
            parent: ".obsidian",
            vault: "vault",
            alias: false,
        },
        {
            name: "a hidden-parent Vault through a resolved symlink",
            parent: ".obsidian",
            vault: "vault",
            alias: true,
        },
        { name: "a dot-prefixed Vault root", parent: "notes", vault: ".vault", alias: false },
        {
            name: "a Vault below a database-like parent",
            parent: "archive-livesync-v2",
            vault: "vault",
            alias: false,
        },
        {
            name: "a database-like Vault root",
            parent: "notes",
            vault: "vault-livesync-v2",
            alias: false,
        },
    ])(
        "keeps monitoring files in $name",
        async ({ parent, vault, alias }) => {
            const fixture = await mkdtemp(join(tmpdir(), "livesync-watch-root-"));
            const physicalVault = join(fixture, parent, vault);
            const aliasPath = join(fixture, "livesync-vault");
            const events: WatchEvent[] = [];
            const diagnostics: unknown[] = [];
            await mkdir(physicalVault, { recursive: true });
            await symlink(physicalVault, aliasPath, "dir");
            const suppliedPath = alias ? aliasPath : physicalVault;
            const watchRoot = await realpath(suppliedPath);
            const { source, adapter } = makeIndexedAdapter(watchRoot, undefined, (message, detail) =>
                diagnostics.push({ message, detail })
            );

            try {
                await source.prepare();
                await adapter.watch.beginWatch(makeHandlers(events));
                const noteName = "new-note.md";
                const notePath = join(physicalVault, noteName);
                await writeFile(notePath, "created after watcher readiness");
                const created = await waitFor(() =>
                    events.some((event) => event.type === "create" && !event.folder && event.path === noteName)
                );
                expect(await readFile(notePath, "utf8")).toBe("created after watcher readiness");
                expect(diagnostics).toEqual([]);
                expect(created, `Expected a new-file event below ${watchRoot}`).toBe(true);

                await writeFile(notePath, "modified after receiving the creation event");
                expect(
                    await waitFor(() => events.some((event) => event.type === "change" && event.path === noteName))
                ).toBe(true);
                await unlink(notePath);
                expect(
                    await waitFor(() => events.some((event) => event.type === "delete" && event.path === noteName))
                ).toBe(true);
            } finally {
                await adapter.close();
                await rm(fixture, { recursive: true, force: true });
            }
        },
        20_000
    );

    it("keeps descendant symlinks outside the shared source's supported storage scope", async () => {
        const fixture = await mkdtemp(join(tmpdir(), "livesync-watch-child-link-"));
        const root = join(fixture, "vault");
        const target = join(fixture, "external");
        await mkdir(root);
        await mkdir(target);
        await symlink(target, join(root, "linked"), "dir");
        const events: WatchEvent[] = [];
        const { source, storage, adapter } = makeIndexedAdapter(root);
        try {
            await source.prepare();
            await adapter.watch.beginWatch(makeHandlers(events));
            await writeFile(join(target, "linked-note.md"), "written through the physical target");
            await writeFile(join(root, "ordinary.md"), "supported storage");
            expect(
                await waitFor(() => events.some((event) => event.type === "create" && event.path === "ordinary.md"))
            ).toBe(true);
            await delay(700);
            expect(events.some((event) => event.path.startsWith("linked/"))).toBe(false);
            expect(await source.getFileNames({ fresh: true })).not.toContain("linked/linked-note.md");
            await expect(storage.stat("linked/linked-note.md")).rejects.toThrow(
                "Storage paths must not contain symbolic links"
            );
        } finally {
            await adapter.close();
            await rm(fixture, { recursive: true, force: true });
        }
    }, 15_000);

    it("reports all 400 files when another process creates directories before dot-temp renames", async () => {
        const root = await mkdtemp(join(tmpdir(), "livesync-issue1328-burst-"));
        const events: WatchEvent[] = [];
        const { source, adapter } = makeIndexedAdapter(root);
        const expectedPaths = Array.from({ length: 40 }, (_, directoryIndex) =>
            Array.from({ length: 10 }, (_, fileIndex) => `book-${directoryIndex}/image-${fileIndex}.png`)
        ).flat();

        try {
            await writeFile(join(root, "present-before-watch.md"), "initial file");
            await source.prepare();
            await adapter.watch.beginWatch(makeHandlers(events));

            await run(process.execPath, ["-e", directoryFirstWriter, root], { timeout: 15_000 });

            const diskPaths = (await readdir(root, { recursive: true })).filter((path) => path.endsWith(".png"));
            expect(diskPaths).toHaveLength(400);

            await waitFor(
                () =>
                    expectedPaths.every((path) =>
                        events.some((event) => event.type === "create" && !event.folder && event.path === path)
                    ),
                12_000
            );

            const createdPaths = new Set(
                events
                    .filter((event) => event.type === "create" && !event.folder && event.path.startsWith("book-"))
                    .map((event) => event.path)
            );
            const missingPaths = expectedPaths.filter((path) => !createdPaths.has(path));

            expect(events.some((event) => event.path === "present-before-watch.md")).toBe(false);
            expect(
                missingPaths.length,
                `Expected create events for all 400 files; received ${createdPaths.size}, missing sample: ${missingPaths
                    .slice(0, 8)
                    .join(", ")}`
            ).toBe(0);
        } finally {
            await adapter.close();
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    it.each(["visible-parent", ".hidden-parent"])(
        "ignores hidden, internal, and custom-ignored entries below %s",
        async (parent) => {
            const fixture = await mkdtemp(join(tmpdir(), "livesync-real-watch-ignore-"));
            const root = join(fixture, parent, "vault");
            await mkdir(root, { recursive: true });
            const events: WatchEvent[] = [];
            const ignoreDirectory = join(root, ".livesync");
            await mkdir(ignoreDirectory);
            await writeFile(join(ignoreDirectory, "ignore"), "private/\n");
            const ignoreRules = new IgnoreRules(root);
            await ignoreRules.load();
            await mkdir(join(root, "private"));
            await mkdir(join(root, "local-livesync-v2"));
            await writeFile(join(root, "present-before-watch.md"), "initial file");
            await writeFile(join(root, ".hidden-before-watch.md"), "initial hidden file");
            const { source, adapter } = makeIndexedAdapter(root, ignoreRules);

            try {
                await source.prepare();
                await adapter.watch.beginWatch(makeHandlers(events));
                await writeFile(join(root, "visible-after-watch.md"), "visible");
                await writeFile(join(root, ".hidden-after-watch.md"), "hidden");
                await writeFile(join(root, "private", "ignored-after-watch.md"), "custom ignored");
                await writeFile(join(root, "local-livesync-v2", "state"), "internal database");

                expect(
                    await waitFor(() =>
                        events.some((event) => event.type === "create" && event.path === "visible-after-watch.md")
                    )
                ).toBe(true);
                await delay(700);

                expect(events.filter((event) => !event.folder)).toEqual([
                    { type: "create", path: "visible-after-watch.md", folder: false },
                ]);
            } finally {
                await adapter.close();
                await rm(fixture, { recursive: true, force: true });
            }
        },
        15_000
    );

    it("reports changes, deletions, rename paths, and stops after close", async () => {
        const root = await mkdtemp(join(tmpdir(), "livesync-real-watch-lifecycle-"));
        const events: WatchEvent[] = [];
        const { source, adapter } = makeIndexedAdapter(root);
        let closed = false;
        let renameCalls = 0;

        try {
            await source.prepare();
            await adapter.watch.beginWatch(makeHandlers(events, () => renameCalls++));

            const originalPath = join(root, "original.md");
            const renamedPath = join(root, "renamed.md");
            await writeFile(originalPath, "first version");
            expect(
                await waitFor(() => events.some((event) => event.type === "create" && event.path === "original.md"))
            ).toBe(true);
            events.length = 0;

            await writeFile(originalPath, "updated version");
            expect(
                await waitFor(() => events.some((event) => event.type === "change" && event.path === "original.md"))
            ).toBe(true);
            events.length = 0;

            await unlink(originalPath);
            expect(
                await waitFor(() => events.some((event) => event.type === "delete" && event.path === "original.md"))
            ).toBe(true);
            events.length = 0;

            await writeFile(originalPath, "rename source");
            expect(
                await waitFor(() =>
                    events.some((event) => event.type === "create" && event.path === "original.md" && !event.folder)
                )
            ).toBe(true);
            events.length = 0;
            await rename(originalPath, renamedPath);
            expect(
                await waitFor(() => {
                    const sourceDeleted = events.some(
                        (event) => event.type === "delete" && event.path === "original.md" && !event.folder
                    );
                    const destinationCreated = events.some(
                        (event) => event.type === "create" && event.path === "renamed.md" && !event.folder
                    );
                    return sourceDeleted && destinationCreated;
                })
            ).toBe(true);
            expect(renameCalls).toBe(0);

            await adapter.close();
            closed = true;
            const eventCountAtClose = events.length;
            await writeFile(join(root, "after-close.md"), "watcher stopped");
            await delay(700);
            expect(events).toHaveLength(eventCountAtClose);
        } finally {
            if (!closed) await adapter.close();
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);
});
