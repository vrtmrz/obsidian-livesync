import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSyncContext } from "./hiddenFileSyncContext.ts";

const PATH = ".obsidian/plugins/example/data.json" as FilePath;

function isTargetFile(context: HiddenFileSyncContext, path: FilePath): Promise<boolean> {
    return (context as unknown as { isTargetFile(path: FilePath): Promise<boolean> }).isTargetFile(path);
}

function isTargetFileEligible(context: HiddenFileSyncContext, path: FilePath): Promise<boolean> {
    return (context as unknown as { isTargetFileEligible(path: FilePath): Promise<boolean> }).isTargetFileEligible(path);
}

function createHiddenFileSync(
    options: { owned?: boolean; ignoredByIgnoreFile?: boolean; patternMatch?: boolean } = {}
) {
    const ownsLocalFile = vi.fn(() => options.owned ?? true);
    const isIgnoredByIgnoreFile = vi.fn(async () => options.ignoredByIgnoreFile ?? false);
    const patternTest = vi.fn(() => options.patternMatch ?? true);
    const parseRegExpSettings = vi.fn(() => ({
        ignoreFilter: [],
        targetFilter: options.patternMatch === undefined ? [] : [{ test: patternTest }],
    }));
    const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
    Object.assign(hiddenFileSync, {
        dependencies: { ownsLocalFile, isIgnoredByIgnoreFile },
        parseRegExpSettings,
    });
    return { hiddenFileSync, isIgnoredByIgnoreFile, parseRegExpSettings, ownsLocalFile };
}

describe("Hidden File Sync local-path admission", () => {
    it("checks composition ownership before Hidden File Sync filters", async () => {
        const { hiddenFileSync, parseRegExpSettings, ownsLocalFile } = createHiddenFileSync({ owned: false });

        await expect(isTargetFile(hiddenFileSync, PATH)).resolves.toBe(false);
        expect(ownsLocalFile).toHaveBeenCalledWith(PATH);
        expect(parseRegExpSettings).not.toHaveBeenCalled();
    });

    it("keeps target patterns and ignore-file results as Hidden File Sync eligibility", async () => {
        const patternExcluded = createHiddenFileSync({ patternMatch: false });
        await expect(isTargetFile(patternExcluded.hiddenFileSync, PATH)).resolves.toBe(false);
        expect(patternExcluded.isIgnoredByIgnoreFile).not.toHaveBeenCalled();

        const ignoreFileExcluded = createHiddenFileSync({ ignoredByIgnoreFile: true });
        await expect(isTargetFile(ignoreFileExcluded.hiddenFileSync, PATH)).resolves.toBe(false);
        expect(ignoreFileExcluded.isIgnoredByIgnoreFile).toHaveBeenCalledWith(PATH);

        const admitted = createHiddenFileSync();
        await expect(isTargetFile(admitted.hiddenFileSync, PATH)).resolves.toBe(true);
    });

    it("evaluates eligibility without consulting the composition owner", async () => {
        const { hiddenFileSync, ownsLocalFile } = createHiddenFileSync({ owned: false });

        await expect(isTargetFileEligible(hiddenFileSync, PATH)).resolves.toBe(true);
        expect(ownsLocalFile).not.toHaveBeenCalled();
    });
});
