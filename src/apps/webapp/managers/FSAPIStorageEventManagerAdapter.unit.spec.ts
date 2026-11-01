import { describe, expect, it, vi } from "vitest";
import { FSAPIStorageEventManagerAdapter } from "./FSAPIStorageEventManagerAdapter";

describe("FSAPIStorageEventManagerAdapter type guard", () => {
    const typeGuard = new FSAPIStorageEventManagerAdapter({} as FileSystemDirectoryHandle, vi.fn()).typeGuard;

    it.each([
        { label: "null", value: null, expected: false },
        { label: "an object without a path", value: { stat: {}, handle: undefined }, expected: false },
        { label: "an object without a stat", value: { path: "note.md", handle: undefined }, expected: false },
        { label: "an object without a handle", value: { path: "note.md", stat: {} }, expected: false },
        {
            label: "a file-shaped object with a handle property",
            value: { path: "note.md", stat: {}, handle: undefined },
            expected: true,
        },
        {
            label: "a folder-shaped object",
            value: { path: "folder", handle: undefined, isFolder: true },
            expected: false,
        },
    ])("classifies $label as a file", ({ value, expected }) => {
        expect(typeGuard.isFile(value)).toBe(expected);
    });

    it.each([
        { label: "null", value: null, expected: false },
        { label: "an object without a path", value: { isFolder: true, handle: undefined }, expected: false },
        { label: "an object without the folder marker", value: { path: "folder", handle: undefined }, expected: false },
        { label: "an object without a handle", value: { path: "folder", isFolder: true }, expected: false },
        {
            label: "a folder-shaped object with a handle property",
            value: { path: "folder", isFolder: true, handle: undefined },
            expected: true,
        },
        { label: "a file-shaped object", value: { path: "note.md", stat: {}, handle: undefined }, expected: false },
    ])("classifies $label as a folder", ({ value, expected }) => {
        expect(typeGuard.isFolder(value)).toBe(expected);
    });
});
