import { describe, expect, it, vi } from "vitest";
import type { CustomRegExpSourceList, FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { CustomRegExp } from "@vrtmrz/livesync-commonlib/compat/common/utils";

import {
    createHiddenFileSyncPathAdmission,
    type HiddenFileSyncPathAdmissionDependencies,
} from "./hiddenFileSyncPathAdmission.ts";

const PATH = ".obsidian/plugins/example/data.json" as FilePath;

const pattern = (matches: (path: string) => boolean) => ({ test: vi.fn(matches) }) as unknown as CustomRegExp;

function createDependencies(
    overrides: Partial<HiddenFileSyncPathAdmissionDependencies> = {}
): HiddenFileSyncPathAdmissionDependencies & {
    getFileRegExp: ReturnType<typeof vi.fn>;
    isIgnoredByIgnoreFile: ReturnType<typeof vi.fn>;
    ownsLocalFile: ReturnType<typeof vi.fn>;
    getTargetPatternSource: ReturnType<typeof vi.fn>;
    getIgnorePatternSource: ReturnType<typeof vi.fn>;
} {
    const getTargetPatternSource = vi.fn(() => "target" as CustomRegExpSourceList<",">);
    const getIgnorePatternSource = vi.fn(() => "ignore" as CustomRegExpSourceList<",">);
    const getFileRegExp = vi.fn((key: "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns") => {
        if (key == "syncInternalFilesIgnorePatterns") return [];
        return [];
    });
    const isIgnoredByIgnoreFile = vi.fn(async () => false);
    const ownsLocalFile = vi.fn(() => true);
    return {
        getTargetPatternSource,
        getIgnorePatternSource,
        getFileRegExp,
        isIgnoredByIgnoreFile,
        ownsLocalFile,
        ...overrides,
    } as HiddenFileSyncPathAdmissionDependencies & {
        getFileRegExp: ReturnType<typeof vi.fn>;
        isIgnoredByIgnoreFile: ReturnType<typeof vi.fn>;
        ownsLocalFile: ReturnType<typeof vi.fn>;
        getTargetPatternSource: ReturnType<typeof vi.fn>;
        getIgnorePatternSource: ReturnType<typeof vi.fn>;
    };
}

describe("Hidden File Sync path admission", () => {
    it("checks composition ownership before reading pattern settings", async () => {
        const dependencies = createDependencies({ ownsLocalFile: vi.fn(() => false) });
        const admission = createHiddenFileSyncPathAdmission(dependencies);

        await expect(admission.isTargetFile(PATH)).resolves.toBe(false);

        expect(dependencies.ownsLocalFile).toHaveBeenCalledWith(PATH);
        expect(dependencies.getTargetPatternSource).not.toHaveBeenCalled();
        expect(dependencies.getIgnorePatternSource).not.toHaveBeenCalled();
        expect(dependencies.getFileRegExp).not.toHaveBeenCalled();
        expect(dependencies.isIgnoredByIgnoreFile).not.toHaveBeenCalled();
    });

    it("checks static path and pattern policy before the asynchronous ignore-file policy", async () => {
        const isIgnoredByIgnoreFile = vi.fn(async () => false);
        const targetFilter = [pattern(() => false)];
        const dependencies = createDependencies({
            getFileRegExp: vi.fn((key: "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns") =>
                key == "syncInternalFilesTargetPatterns" ? targetFilter : []
            ),
            isIgnoredByIgnoreFile,
        });
        const admission = createHiddenFileSyncPathAdmission(dependencies);

        await expect(admission.isTargetFile(PATH)).resolves.toBe(false);
        await expect(admission.isTargetFile("notes/example.md" as FilePath)).resolves.toBe(false);

        expect(isIgnoredByIgnoreFile).not.toHaveBeenCalled();
    });

    it("adopts target and ignore patterns while preserving their policy order", async () => {
        const calls: string[] = [];
        const targetFilter = [pattern(() => true)];
        const ignoreFilter = [pattern(() => true)];
        const getFileRegExp = vi.fn((key: "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns") => {
            calls.push(key);
            return key == "syncInternalFilesTargetPatterns" ? targetFilter : ignoreFilter;
        });
        const isIgnoredByIgnoreFile = vi.fn(async () => false);
        const dependencies = createDependencies({ getFileRegExp, isIgnoredByIgnoreFile });
        const admission = createHiddenFileSyncPathAdmission(dependencies);

        await expect(admission.isTargetFile(PATH)).resolves.toBe(false);

        expect(calls).toEqual(["syncInternalFilesIgnorePatterns", "syncInternalFilesTargetPatterns"]);
        expect(targetFilter[0].test).not.toHaveBeenCalled();
        expect(isIgnoredByIgnoreFile).not.toHaveBeenCalled();
    });

    it("caches parsed filters per owner and refreshes them when sources or settings change", async () => {
        const targetFilter = [pattern(() => true)];
        const ignoreFilter: CustomRegExp[] = [];
        let targetSource = "target" as CustomRegExpSourceList<",">;
        const getTargetPatternSource = vi.fn(() => targetSource);
        const getFileRegExp = vi.fn((key: "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns") =>
            key == "syncInternalFilesTargetPatterns" ? targetFilter : ignoreFilter
        );
        const dependencies = createDependencies({ getTargetPatternSource, getFileRegExp });
        const admission = createHiddenFileSyncPathAdmission(dependencies);

        await expect(admission.isTargetFile(PATH)).resolves.toBe(true);
        await expect(admission.isTargetFile(PATH)).resolves.toBe(true);
        expect(getFileRegExp).toHaveBeenCalledTimes(2);

        targetSource = "changed" as CustomRegExpSourceList<",">;
        await expect(admission.isTargetFile(PATH)).resolves.toBe(true);
        expect(getFileRegExp).toHaveBeenCalledTimes(4);

        admission.invalidatePatternCache();
        await expect(admission.isTargetFile(PATH)).resolves.toBe(true);
        expect(getFileRegExp).toHaveBeenCalledTimes(6);
    });

    it("does not share the pattern cache between owners and clears it on disposal", async () => {
        const firstDependencies = createDependencies();
        const secondDependencies = createDependencies();
        const first = createHiddenFileSyncPathAdmission(firstDependencies);
        const second = createHiddenFileSyncPathAdmission(secondDependencies);

        await first.isTargetFile(PATH);
        await first.isTargetFile(PATH);
        await second.isTargetFile(PATH);
        expect(firstDependencies.getFileRegExp).toHaveBeenCalledTimes(2);
        expect(secondDependencies.getFileRegExp).toHaveBeenCalledTimes(2);

        first.dispose();
        first.dispose();
        await first.isTargetFile(PATH);
        expect(firstDependencies.getFileRegExp).toHaveBeenCalledTimes(4);
        expect(secondDependencies.getFileRegExp).toHaveBeenCalledTimes(2);
    });
});
