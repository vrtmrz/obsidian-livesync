import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({ JsonResolveModal: class JsonResolveModal {} }));
vi.mock("@/modules/features/ModuleLog.ts", () => ({ MARK_DONE: "" }));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({ configureHiddenFileSyncMode: vi.fn() }));

import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { readContent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { createOptionalFileSyncDatabase, optionalFileEntry } from "../../../test/fixtures/optionalFileSyncDatabase";
import { HiddenFileSync } from "./CmdHiddenFileSync";

const hiddenPath = ".obsidian/plugins/example/main.js" as FilePath;
const prefixedPath = `i:${hiddenPath}`;
const body = "module.exports = class ExamplePlugin {};";
const allowList = "\\.(?:md|png|pdf)$";
const fixtureOwners: Awaited<ReturnType<typeof createOptionalFileSyncDatabase>>[] = [];

async function hiddenFiles() {
    const fixture = await createOptionalFileSyncDatabase();
    fixtureOwners.push(fixture);
    fixture.settings.usePluginSync = false;
    const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
    Object.assign(hiddenFileSync, {
        core: {
            settings: fixture.settings,
            services: {
                ...fixture.services,
                vault: { isIgnoredByIgnoreFile: vi.fn(async () => false) },
            },
        },
        cacheFileRegExps: new Map(),
        cacheCustomisationSyncIgnoredFiles: new Map(),
    });
    return { ...fixture, hiddenFileSync };
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const fixture of fixtureOwners.splice(0)) await fixture.dispose();
});

describe("issue #1272: Hidden File Sync with normal-file selectors", () => {
    it("stores a selected hidden file while the normal-file allow-list is set", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(true);

        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(prefixedPath, body))).resolves.toMatchObject({
            ok: true,
        });
        const stored = await fixture.localDatabase.getDBEntry(prefixedPath as FilePath);
        expect(stored).not.toBe(false);
        if (stored) expect(await readContent(stored)).toBe(body);
    });

    it("reads existing hidden-file content while the normal-file allow-list is set", async () => {
        const fixture = await hiddenFiles();
        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(prefixedPath, body))).resolves.toMatchObject({
            ok: true,
        });
        const meta = await fixture.localDatabase.getDBEntryMeta(prefixedPath as FilePath);
        if (!meta) throw new Error("The seeded hidden-file Metadata is unavailable");
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(true);

        const entry = await fixture.localDatabase.getDBEntryFromMeta(meta);
        expect(entry).not.toBe(false);
        if (entry) expect(await readContent(entry)).toBe(body);
    });

    it("stores and reads the same hidden file when the normal-file allow-list is empty", async () => {
        const fixture = await hiddenFiles();
        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(prefixedPath, body))).resolves.toMatchObject({
            ok: true,
        });
        const entry = await fixture.localDatabase.getDBEntry(prefixedPath as FilePath);
        expect(entry).not.toBe(false);
        if (entry) expect(await readContent(entry)).toBe(body);
    });

    it("continues to apply the normal-file allow-list to ordinary files", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        expect(fixture.localDatabase.isTargetFile("notes/example.md" as FilePath)).toBe(true);
        expect(fixture.localDatabase.isTargetFile("notes/example.js" as FilePath)).toBe(false);
        expect(fixture.localDatabase.isTargetFile("i:.obsidian/example.md" as FilePath)).toBe(true);
    });

    it("keeps Customisation Sync documents usable with the same normal-file allow-list", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        const path = "ix:device/PLUGIN_MAIN/example%main.js" as FilePath;
        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(path, body))).resolves.toMatchObject({
            ok: true,
        });
        const entry = await fixture.localDatabase.getDBEntry(path);
        expect(entry).not.toBe(false);
        if (entry) expect(await readContent(entry)).toBe(body);
    });

    it("keeps Hidden File Sync target and ignore patterns effective", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncInternalFilesTargetPatterns =
            "^\\.obsidian/plugins/" as typeof fixture.settings.syncInternalFilesTargetPatterns;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(true);
        await expect(fixture.hiddenFileSync.isTargetFile(".obsidian/snippets/example.css" as FilePath)).resolves.toBe(
            false
        );
        fixture.settings.syncInternalFilesIgnorePatterns =
            "main\\.js$" as typeof fixture.settings.syncInternalFilesIgnorePatterns;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(false);
    });

    it("compatibility: applies the normal-file ignore-list to hidden documents", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        fixture.settings.syncIgnoreRegEx = "^\\.obsidian/" as typeof fixture.settings.syncIgnoreRegEx;
        expect(fixture.localDatabase.isTargetFile(prefixedPath as FilePath)).toBe(false);
    });

    it("rejects hidden documents when Hidden File Sync is disabled", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncInternalFiles = false;
        expect(fixture.localDatabase.isTargetFile(prefixedPath as FilePath)).toBe(false);
    });
});
