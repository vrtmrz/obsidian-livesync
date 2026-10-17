import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmdirSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, TFile } from "obsidian";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ObsidianStorageAdapter } from "./ObsidianStorageAdapter";
import { ObsidianVaultAdapter } from "./ObsidianVaultAdapter";
import { createPathAliasGuard } from "./pathAliasGuard";

const REFUSAL = "Refusing a path which reaches an existing entry by a name its folder does not list.";
const CONFIG_DIRECTORY = ".obsidian";
const PLUGIN_DIRECTORY = `${CONFIG_DIRECTORY}/plugins/obsidian-livesync`;
const PLUGIN_ENTRY = `${PLUGIN_DIRECTORY}/main.js`;
const DIRECTORY_ALIAS_ENTRY = "OBSIDI~1/plugins/obsidian-livesync/main.js";
const FILE_ALIAS_ENTRY = `${PLUGIN_DIRECTORY}/MAIN~1.JS`;

const fold = (value: string) => value.normalize("NFC").toLowerCase();

function fakeApp() {
    const indexed = new Set(["notes", "notes/existing.md"].map(fold));
    const existing = new Set(
        [
            CONFIG_DIRECTORY,
            `${CONFIG_DIRECTORY}/plugins`,
            PLUGIN_DIRECTORY,
            PLUGIN_ENTRY,
            "notes",
            "notes/existing.md",
        ].map(fold)
    );
    const aliases = new Map([
        [fold("OBSIDI~1"), CONFIG_DIRECTORY],
        [fold(`${PLUGIN_DIRECTORY}/MAIN~1.JS`), PLUGIN_ENTRY],
    ]);
    const resolveAlias = (path: string) => {
        const direct = aliases.get(fold(path));
        if (direct) return direct;
        if (fold(path).startsWith("obsidi~1/")) return `${CONFIG_DIRECTORY}/${path.slice("OBSIDI~1/".length)}`;
        return path;
    };
    const listings = new Map<string, { files: string[]; folders: string[] }>([
        ["/", { files: [], folders: [CONFIG_DIRECTORY, "notes"] }],
        [fold(CONFIG_DIRECTORY), { files: [], folders: [`${CONFIG_DIRECTORY}/plugins`] }],
        [fold(`${CONFIG_DIRECTORY}/plugins`), { files: [], folders: [PLUGIN_DIRECTORY] }],
        [fold(PLUGIN_DIRECTORY), { files: [PLUGIN_ENTRY], folders: [] }],
        [fold("notes"), { files: ["notes/existing.md"], folders: [] }],
    ]);
    const calls = {
        write: vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(undefined),
        append: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        modify: vi.fn().mockResolvedValue(undefined),
        modifyBinary: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({}),
        createBinary: vi.fn().mockResolvedValue({}),
        rename: vi.fn().mockResolvedValue(undefined),
        trashFile: vi.fn().mockResolvedValue(undefined),
    };
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => (indexed.has(fold(path)) ? {} : null),
            adapter: {
                exists: async (path: string) => existing.has(fold(resolveAlias(path))),
                list: async (path: string) =>
                    listings.get(path === "/" ? "/" : fold(path)) ?? { files: [], folders: [] },
                read: vi.fn(),
                readBinary: vi.fn(),
                stat: vi.fn(),
                write: calls.write,
                writeBinary: calls.writeBinary,
                append: calls.append,
                mkdir: calls.mkdir,
                remove: calls.remove,
            },
            cachedRead: vi.fn(),
            readBinary: vi.fn(),
            modify: calls.modify,
            modifyBinary: calls.modifyBinary,
            create: calls.create,
            createBinary: calls.createBinary,
            rename: calls.rename,
            trigger: vi.fn(),
        },
        fileManager: {
            trashFile: calls.trashFile,
        },
    } as unknown as App;
    return { app, calls };
}

describe("paths which resolve to an existing entry under an unlisted name", () => {
    it("refuses every mutating storage-adapter operation", async () => {
        const { app, calls } = fakeApp();
        const adapter = new ObsidianStorageAdapter(app);

        await expect(adapter.write(DIRECTORY_ALIAS_ENTRY, "replacement")).rejects.toThrow(REFUSAL);
        await expect(adapter.writeBinary(FILE_ALIAS_ENTRY, new ArrayBuffer(1))).rejects.toThrow(REFUSAL);
        await expect(adapter.append(FILE_ALIAS_ENTRY, "replacement")).rejects.toThrow(REFUSAL);
        await expect(adapter.mkdir("OBSIDI~1/new-directory")).rejects.toThrow(REFUSAL);
        await expect(adapter.remove(DIRECTORY_ALIAS_ENTRY)).rejects.toThrow(REFUSAL);

        expect(calls.write).not.toHaveBeenCalled();
        expect(calls.writeBinary).not.toHaveBeenCalled();
        expect(calls.append).not.toHaveBeenCalled();
        expect(calls.mkdir).not.toHaveBeenCalled();
        expect(calls.remove).not.toHaveBeenCalled();
    });

    it("refuses every mutating vault-adapter operation", async () => {
        const { app, calls } = fakeApp();
        const adapter = new ObsidianVaultAdapter(app);
        const aliasFile = { path: DIRECTORY_ALIAS_ENTRY } as TFile;

        await expect(adapter.modify(aliasFile, "replacement")).rejects.toThrow(REFUSAL);
        await expect(adapter.modifyBinary(aliasFile, new ArrayBuffer(1))).rejects.toThrow(REFUSAL);
        await expect(adapter.create(DIRECTORY_ALIAS_ENTRY, "replacement")).rejects.toThrow(REFUSAL);
        await expect(adapter.createBinary(FILE_ALIAS_ENTRY, new ArrayBuffer(1))).rejects.toThrow(REFUSAL);
        await expect(adapter.rename({ path: "notes/existing.md" } as TFile, DIRECTORY_ALIAS_ENTRY)).rejects.toThrow(
            REFUSAL
        );
        await expect(adapter.delete(aliasFile)).rejects.toThrow(REFUSAL);
        await expect(adapter.trash(aliasFile)).rejects.toThrow(REFUSAL);

        expect(calls.modify).not.toHaveBeenCalled();
        expect(calls.modifyBinary).not.toHaveBeenCalled();
        expect(calls.create).not.toHaveBeenCalled();
        expect(calls.createBinary).not.toHaveBeenCalled();
        expect(calls.rename).not.toHaveBeenCalled();
        expect(calls.trashFile).not.toHaveBeenCalled();
    });

    it("allows listed names, case-only differences, indexed paths, and new files", async () => {
        const { app, calls } = fakeApp();
        const adapter = new ObsidianStorageAdapter(app);

        await adapter.write(`${PLUGIN_DIRECTORY}/data.json`, "settings");
        await adapter.write(".OBSIDIAN/PLUGINS/OBSIDIAN-LIVESYNC/new.json", "settings");
        await adapter.write("notes/new.md", "note");
        await adapter.write("notes/existing.md", "updated");

        expect(calls.write).toHaveBeenCalledTimes(4);
    });
});

const realRoot = mkdtempSync(join(tmpdir(), "path-alias-guard-"));
const REAL_FOLDER = "configuration-folder";
const REAL_FILE = "trusted-release-keys.json";
const realFolder = join(realRoot, REAL_FOLDER);
const realFile = join(realFolder, REAL_FILE);
mkdirSync(realFolder);
writeFileSync(realFile, "synthetic trusted keys");

function removeRealFixture(): void {
    const optionalPaths = [join(realFolder, "other.json"), join(realFolder, "new-directory")];
    if (existsSync(optionalPaths[0])) unlinkSync(optionalPaths[0]);
    if (existsSync(optionalPaths[1])) rmdirSync(optionalPaths[1]);
    if (existsSync(realFile)) unlinkSync(realFile);
    if (existsSync(realFolder)) rmdirSync(realFolder);
    if (existsSync(realRoot)) rmdirSync(realRoot);
}

afterAll(removeRealFixture);

function aliasCandidates(name: string): string[] {
    const [base, extension = ""] = name.split(/\.(?=[^.]*$)/u);
    const shortName = `${base.slice(0, 6).toUpperCase()}~1${extension ? `.${extension.slice(0, 3).toUpperCase()}` : ""}`;
    return [shortName, `${name}.`, `${name} `];
}

function isAlias(folder: string, name: string): boolean {
    const directory = join(realRoot, folder);
    return existsSync(join(directory, name)) && !readdirSync(directory).some((listed) => fold(listed) === fold(name));
}

const realFolderAliases = aliasCandidates(REAL_FOLDER).filter((candidate) => isAlias("", candidate));
const realAliases = [
    ...realFolderAliases.map((candidate) => `${candidate}/${REAL_FILE}`),
    ...aliasCandidates(REAL_FILE)
        .filter((candidate) => isAlias(REAL_FOLDER, candidate))
        .map((candidate) => `${REAL_FOLDER}/${candidate}`),
];

function realApp() {
    const full = (path: string) => join(realRoot, path === "/" ? "" : path);
    return {
        vault: {
            getAbstractFileByPath: () => null,
            adapter: {
                exists: async (path: string) => existsSync(full(path)),
                list: async (path: string) => {
                    const prefix = path === "/" || path === "" ? "" : `${path}/`;
                    const names = readdirSync(full(path));
                    const isFile = (name: string) => statSync(join(full(path), name)).isFile();
                    return {
                        files: names.filter(isFile).map((name) => `${prefix}${name}`),
                        folders: names.filter((name) => !isFile(name)).map((name) => `${prefix}${name}`),
                    };
                },
                write: async (path: string, data: string) => writeFileSync(full(path), data),
                remove: async (path: string) => unlinkSync(full(path)),
                mkdir: async (path: string) => mkdirSync(full(path)),
            },
        },
    };
}

describe("the host file system", () => {
    it.skipIf(realAliases.length === 0)(
        "refuses names which resolve but are not listed by their directory",
        async () => {
            const app = realApp();
            const adapter = new ObsidianStorageAdapter(app as unknown as App, createPathAliasGuard(app));

            for (const aliasPath of realAliases) {
                expect(readFileSync(join(realRoot, aliasPath), "utf8")).toBe("synthetic trusted keys");
                await expect(adapter.write(aliasPath, "replacement")).rejects.toThrow(REFUSAL);
                await expect(adapter.remove(aliasPath)).rejects.toThrow(REFUSAL);
                await expect(adapter.mkdir(`${aliasPath}/new-directory`)).rejects.toThrow(REFUSAL);
            }
            for (const folderAlias of realFolderAliases) {
                await expect(adapter.write(`${folderAlias}/new.json`, "replacement")).rejects.toThrow(REFUSAL);
                await expect(adapter.mkdir(`${folderAlias}/new-directory`)).rejects.toThrow(REFUSAL);
            }

            expect(readFileSync(realFile, "utf8")).toBe("synthetic trusted keys");
            expect(existsSync(join(realFolder, "new.json"))).toBe(false);
            expect(existsSync(join(realFolder, "new-directory"))).toBe(false);
        }
    );
});
