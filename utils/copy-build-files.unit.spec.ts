import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyBuildFiles } from "./copy-build-files";

const BUILD_FILES = ["manifest.json", "main.js", "styles.css"] as const;

let temporaryDirectory: string;

function createCopyPlugin(sourceDirectory: string, destinations: string[]): Plugin {
    return copyBuildFiles(destinations, sourceDirectory);
}

async function runWriteBundle(plugin: Plugin): Promise<void> {
    const hook = plugin.writeBundle as
        | ((this: Plugin) => unknown)
        | { handler?: (this: Plugin) => unknown }
        | undefined;
    const handler = typeof hook === "function" ? hook : hook?.handler;
    if (!handler) {
        throw new Error("The copy plug-in does not define a writeBundle hook");
    }
    await handler.call(plugin);
}

describe("build file copying", () => {
    beforeEach(async () => {
        temporaryDirectory = await mkdtemp(join(tmpdir(), "livesync-copy-build-files-"));
    });

    afterEach(async () => {
        await rm(temporaryDirectory, { recursive: true, force: true });
    });

    it("does nothing when no destinations are configured", async () => {
        const plugin = createCopyPlugin(join(temporaryDirectory, "missing-source"), []);

        await expect(runWriteBundle(plugin)).resolves.toBeUndefined();
    });

    it("copies the fixed build files to nested destinations and overwrites them on repeated builds", async () => {
        const sourceDirectory = join(temporaryDirectory, "build");
        const destinations = [
            join(temporaryDirectory, "vault-one", ".obsidian", "plugins", "livesync"),
            join(temporaryDirectory, "vault-two", "nested", ".obsidian", "plugins", "livesync"),
        ];
        await mkdir(sourceDirectory, { recursive: true });
        await Promise.all(BUILD_FILES.map((file) => writeFile(join(sourceDirectory, file), `first ${file}`)));
        await mkdir(destinations[0], { recursive: true });
        await writeFile(join(destinations[0], "manifest.json"), "stale manifest");

        const plugin = createCopyPlugin(sourceDirectory, destinations);
        expect(plugin.writeBundle).toBeDefined();
        await runWriteBundle(plugin);

        for (const destination of destinations) {
            for (const file of BUILD_FILES) {
                await expect(readFile(join(destination, file), "utf8")).resolves.toBe(`first ${file}`);
            }
        }

        await writeFile(join(sourceDirectory, "main.js"), "second main.js");
        await runWriteBundle(plugin);

        for (const destination of destinations) {
            await expect(readFile(join(destination, "main.js"), "utf8")).resolves.toBe("second main.js");
        }
    });

    it("skips missing source files", async () => {
        const sourceDirectory = join(temporaryDirectory, "partial-build");
        const destination = join(temporaryDirectory, "vault", ".obsidian", "plugins", "livesync");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "manifest.json"), "manifest");

        await runWriteBundle(createCopyPlugin(sourceDirectory, [destination]));

        await expect(readFile(join(destination, "manifest.json"), "utf8")).resolves.toBe("manifest");
        await expect(readFile(join(destination, "main.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(join(destination, "styles.css"), "utf8")).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("propagates source path errors", async () => {
        const invalidSourceDirectory = join(temporaryDirectory, "source-is-a-file");
        await writeFile(invalidSourceDirectory, "not a directory");

        await expect(
            runWriteBundle(createCopyPlugin(invalidSourceDirectory, [join(temporaryDirectory, "vault")]))
        ).rejects.toMatchObject({ code: "ENOTDIR" });
    });

    it("propagates destination errors", async () => {
        const sourceDirectory = join(temporaryDirectory, "build");
        const destinationParent = join(temporaryDirectory, "destination-is-a-file");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "manifest.json"), "manifest");
        await writeFile(destinationParent, "not a directory");

        await expect(
            runWriteBundle(createCopyPlugin(sourceDirectory, [join(destinationParent, "nested")]))
        ).rejects.toMatchObject({ code: "ENOTDIR" });
    });
});
