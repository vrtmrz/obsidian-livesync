import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { IStorageEventWatchHandlers } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
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
    it("reports all 400 files when another process creates directories before dot-temp renames", async () => {
        const root = await mkdtemp(join(tmpdir(), "livesync-issue1328-burst-"));
        const events: WatchEvent[] = [];
        const adapter = new CLIStorageEventManagerAdapter(root, undefined, true);
        const expectedPaths = Array.from({ length: 40 }, (_, directoryIndex) =>
            Array.from({ length: 10 }, (_, fileIndex) => `book-${directoryIndex}/image-${fileIndex}.png`)
        ).flat();

        try {
            await writeFile(join(root, "present-before-watch.md"), "initial file");
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

    it("ignores initial, hidden, and custom-ignored files while watching visible files", async () => {
        const root = await mkdtemp(join(tmpdir(), "livesync-real-watch-ignore-"));
        const events: WatchEvent[] = [];
        const ignoreDirectory = join(root, ".livesync");
        await mkdir(ignoreDirectory);
        await writeFile(join(ignoreDirectory, "ignore"), "private/\n");
        const ignoreRules = new IgnoreRules(root);
        await ignoreRules.load();
        await mkdir(join(root, "private"));
        await writeFile(join(root, "present-before-watch.md"), "initial file");
        await writeFile(join(root, ".hidden-before-watch.md"), "initial hidden file");
        const adapter = new CLIStorageEventManagerAdapter(root, ignoreRules, true);

        try {
            await adapter.watch.beginWatch(makeHandlers(events));
            await writeFile(join(root, "visible-after-watch.md"), "visible");
            await writeFile(join(root, ".hidden-after-watch.md"), "hidden");
            await writeFile(join(root, "private", "ignored-after-watch.md"), "custom ignored");

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
            await rm(root, { recursive: true, force: true });
        }
    }, 15_000);

    it("reports changes, deletions, rename paths, and stops after close", async () => {
        const root = await mkdtemp(join(tmpdir(), "livesync-real-watch-lifecycle-"));
        const events: WatchEvent[] = [];
        const adapter = new CLIStorageEventManagerAdapter(root, undefined, true);
        let closed = false;
        let renameCalls = 0;

        try {
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
