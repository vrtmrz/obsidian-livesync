import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "@vrtmrz/livesync-commonlib/storage";
import { findInvalidatedDirectoryScopes } from "./CLIFileNameSource.paths";

describe("physical directory scopes for invalidation", () => {
    it.each([true, false])(
        "retains every Legacy parent admitted by the effective case policy (sensitive: %s)",
        (sensitive) => {
            const directories = new Map<string, readonly DirectoryEntry[]>([
                [
                    "",
                    [
                        { name: "Docs", kind: "directory" },
                        { name: "docs", kind: "directory" },
                        { name: "other", kind: "directory" },
                    ],
                ],
                ["Docs", []],
                ["docs", []],
                ["other", []],
            ]);
            const scopes = findInvalidatedDirectoryScopes(directories, "docs", {
                pathNormalizationVersion: 0,
                handleFilenameCaseSensitive: sensitive,
            });
            expect([...scopes].sort()).toEqual(sensitive ? ["docs"] : ["Docs", "docs"]);
        }
    );
});
