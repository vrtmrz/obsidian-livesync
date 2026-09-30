import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    normalizePath: vi.fn((path: string) => `normalised(${path})`),
    path2idBase: vi.fn(async (path: string) => path),
    id2pathBase: vi.fn((path: string) => path),
    expandFilePathPrefix: vi.fn((path: string): [string, string] => {
        if (path.startsWith("i:")) return ["i:", path.substring(2)];
        return ["", path];
    }),
}));

vi.mock("@/deps.ts", () => ({
    normalizePath: mocks.normalizePath,
    Platform: {},
    requestUrl: vi.fn(),
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/string_and_binary/path", () => ({
    path2id_base: mocks.path2idBase,
    id2path_base: mocks.id2pathBase,
    expandFilePathPrefix: mocks.expandFilePathPrefix,
    isValidFilenameInLinux: vi.fn(),
    isValidFilenameInDarwin: vi.fn(),
    isValidFilenameInWidows: vi.fn(),
    isValidFilenameInAndroid: vi.fn(),
    stripAllPrefixes: vi.fn(),
}));

describe("path ID normalisation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ["Folder/Note.md", "", "Folder/Note.md"],
        ["Folder/Poem: Example.md", "", "Folder/Poem: Example.md"],
        ["Folder/Poem: Example: Final Draft.md", "", "Folder/Poem: Example: Final Draft.md"],
        ["i:Folder/Poem: Example.md", "i:", "Folder/Poem: Example.md"],
    ])("normalises the complete path body for %s", async (filename, prefix, body) => {
        const { path2id } = await import("./utils.ts");

        const result = await path2id(filename as never, false, false);

        expect(mocks.normalizePath).toHaveBeenCalledWith(body);
        expect(mocks.path2idBase).toHaveBeenCalledWith(`${prefix}normalised(${body})`, false, false);
        expect(result).toBe(`${prefix}normalised(${body})`);
    });

    it.each([
        ["Folder/Note.md", "", "Folder/Note.md"],
        ["Folder/Poem: Example.md", "", "Folder/Poem: Example.md"],
        ["Folder/Poem: Example: Final Draft.md", "", "Folder/Poem: Example: Final Draft.md"],
        ["i:Folder/Poem: Example.md", "i:", "Folder/Poem: Example.md"],
    ])("preserves the path namespace while normalising %s", async (filename, prefix, body) => {
        mocks.id2pathBase.mockReturnValue(filename);
        const { id2path } = await import("./utils.ts");

        const result = id2path(filename as never);

        expect(mocks.normalizePath).toHaveBeenCalledWith(body);
        expect(result).toBe(`${prefix}normalised(${body})`);
    });
});
