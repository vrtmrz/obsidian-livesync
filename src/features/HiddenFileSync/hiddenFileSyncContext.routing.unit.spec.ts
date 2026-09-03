import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSyncContext } from "./hiddenFileSyncContext.ts";

const PATH = ".obsidian/plugins/example/data.json" as FilePath;

function createHiddenFileSync(
    options: { owned?: boolean; ignoredByIgnoreFile?: boolean; patternMatch?: boolean } = {}
) {
    const ownsLocalFile = vi.fn(() => options.owned ?? true);
    const isIgnoredByIgnoreFile = vi.fn(async () => options.ignoredByIgnoreFile ?? false);
    const isTargetFileInPatterns = vi.fn(() => options.patternMatch ?? true);
    const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
    Object.assign(hiddenFileSync, {
        dependencies: { ownsLocalFile, isIgnoredByIgnoreFile },
        isTargetFileInPatterns,
    });
    return { hiddenFileSync, isIgnoredByIgnoreFile, isTargetFileInPatterns, ownsLocalFile };
}

describe("Hidden File Sync local-path admission", () => {
    it("checks composition ownership before Hidden File Sync filters", async () => {
        const { hiddenFileSync, isTargetFileInPatterns, ownsLocalFile } = createHiddenFileSync({ owned: false });

        await expect(hiddenFileSync.isTargetFile(PATH)).resolves.toBe(false);
        expect(ownsLocalFile).toHaveBeenCalledWith(PATH);
        expect(isTargetFileInPatterns).not.toHaveBeenCalled();
    });

    it("keeps target patterns and ignore-file results as Hidden File Sync eligibility", async () => {
        const patternExcluded = createHiddenFileSync({ patternMatch: false });
        await expect(patternExcluded.hiddenFileSync.isTargetFile(PATH)).resolves.toBe(false);
        expect(patternExcluded.isIgnoredByIgnoreFile).not.toHaveBeenCalled();

        const ignoreFileExcluded = createHiddenFileSync({ ignoredByIgnoreFile: true });
        await expect(ignoreFileExcluded.hiddenFileSync.isTargetFile(PATH)).resolves.toBe(false);
        expect(ignoreFileExcluded.isIgnoredByIgnoreFile).toHaveBeenCalledWith(PATH);

        const admitted = createHiddenFileSync();
        await expect(admitted.hiddenFileSync.isTargetFile(PATH)).resolves.toBe(true);
    });

    it("exposes eligibility without consulting the composition owner", async () => {
        const { hiddenFileSync, ownsLocalFile } = createHiddenFileSync({ owned: false });

        await expect(hiddenFileSync.isTargetFileEligible(PATH)).resolves.toBe(true);
        expect(ownsLocalFile).not.toHaveBeenCalled();
    });
});

describe("compatibility: Hidden File Sync path shape", () => {
    const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;

    it.each([
        [".obsidian/app.json", true],
        [".trash/app.json", false],
        ["notes/app.json", false],
    ])("recognises %s as a Hidden File Sync path=%s", (path, expected) => {
        expect(hiddenFileSync.isHiddenFileSyncHandlingPath(path as FilePath)).toBe(expected);
    });
});
