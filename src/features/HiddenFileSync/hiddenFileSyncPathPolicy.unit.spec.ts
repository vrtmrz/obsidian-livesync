import { describe, expect, it, vi } from "vitest";
import type { CustomRegExp } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { isHiddenFileSyncPath, matchesHiddenFileSyncPatterns } from "./hiddenFileSyncPathPolicy.ts";

const pattern = (matches: (path: string) => boolean) => ({ test: vi.fn(matches) }) as unknown as CustomRegExp;

describe("isHiddenFileSyncPath", () => {
    it.each([
        [".obsidian/app.json", true],
        [".git/config", true],
        [".trash/app.json", false],
        [".trashcan/app.json", false],
        ["notes/.hidden", false],
    ])("classifies %s as a Hidden File Sync path=%s", (path, expected) => {
        expect(isHiddenFileSyncPath(path)).toBe(expected);
    });
});

describe("matchesHiddenFileSyncPatterns", () => {
    it("allows every path when no filters are configured", () => {
        expect(matchesHiddenFileSyncPatterns(".obsidian/app.json", { ignoreFilter: [], targetFilter: [] })).toBe(true);
    });

    it("uses target patterns as an allow-list", () => {
        const targetFilter = [pattern((path) => path.endsWith(".json"))];

        expect(matchesHiddenFileSyncPatterns(".obsidian/app.json", { ignoreFilter: [], targetFilter })).toBe(true);
        expect(matchesHiddenFileSyncPatterns(".obsidian/theme.css", { ignoreFilter: [], targetFilter })).toBe(false);
    });

    it("gives ignore patterns precedence over target patterns", () => {
        const matchesEverything = pattern(() => true);

        expect(
            matchesHiddenFileSyncPatterns(".obsidian/app.json", {
                ignoreFilter: [matchesEverything],
                targetFilter: [matchesEverything],
            })
        ).toBe(false);
    });
});
