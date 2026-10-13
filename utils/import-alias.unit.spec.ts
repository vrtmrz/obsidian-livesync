import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import svelteParser from "svelte-eslint-parser";
import importAlias, { resolveSourceAlias } from "./import-alias.mjs";
import { resolve } from "node:path";

const cwd = process.cwd();
const rule = importAlias.rules["prefer-source-alias"];

function lint(code: string, filename = "src/modules/example.ts") {
    const linter = new Linter({ cwd });
    return linter.verifyAndFix(
        code,
        [
            {
                files: ["**/*.ts", "**/*.svelte"],
                languageOptions: {
                    parser: filename.endsWith(".svelte") ? svelteParser : tsParser,
                    parserOptions: { parser: tsParser },
                },
                plugins: { local: { rules: { "prefer-source-alias": rule } } },
                rules: {
                    "local/prefer-source-alias": ["error", { sourceRoot: "./src" }],
                },
            },
        ],
        { filename: resolve(cwd, filename) }
    );
}

describe("source import aliases", () => {
    it.each([
        ["src/modules/example.ts", "../common/types", "@/common/types"],
        ["src/modules/example.ts", "./../common/types", "@/common/types"],
        ["src/modules/example.ts", "..", "@"],
        ["src/modules/example.ts", "../common/types.js", "@/common/types.js"],
        ["src/apps/browser/main.ts", "../../common/types", "@/common/types"],
        ["src/apps/cli/main.ts", "../../common/types", "@/common/types"],
        ["src/apps/webapp/main.ts", "../../common/types", "@/common/types"],
        ["src/apps/webpeer/src/main.ts", "../../../common/types", "@/common/types"],
    ])("rewrites %s parent import %s to %s", (filename, sourcePath, expected) => {
        const result = lint(`import type { Value } from '${sourcePath}';`, filename);
        expect(result.messages).toEqual([]);
        expect(result.fixed).toBe(true);
        expect(result.output).toBe(`import type { Value } from '${expected}';`);
    });

    it.each([
        "./helper",
        "@/common/types",
        "@vrtmrz/livesync-commonlib/common/types",
        "node:path",
        "../../test/helper",
    ])("preserves import %s", (sourcePath) => {
        const code = `import value from "${sourcePath}";`;
        const result = lint(code);
        expect(result.messages).toEqual([]);
        expect(result.fixed).toBe(false);
        expect(result.output).toBe(code);
    });

    it("does not treat a sibling directory whose name begins with src as source-owned", () => {
        const code = 'import value from "../../src-other/helper";';
        const result = lint(code);
        expect(result.messages).toEqual([]);
        expect(result.fixed).toBe(false);
        expect(result.output).toBe(code);
    });

    it("rewrites imports inside Svelte scripts", () => {
        const result = lint(
            '<script lang="ts">import type { Value } from "../../common/types";</script>',
            "src/components/dialog/Example.svelte"
        );
        expect(result.messages).toEqual([]);
        expect(result.fixed).toBe(true);
        expect(result.output).toBe('<script lang="ts">import type { Value } from "@/common/types";</script>');
    });

    it.each([
        ["C:\\live\\src\\modules\\file.ts", "../common/types", "C:\\live", "@/common/types"],
        ["C:\\live\\src\\apps\\webpeer\\src\\main.ts", "../../../common/types", "C:\\live", "@/common/types"],
        ["C:\\live\\src\\modules\\file.ts", "../../src-other/helper", "C:\\live", null],
        [
            "\\\\server\\share\\live\\src\\modules\\file.ts",
            "../common/types",
            "\\\\server\\share\\live",
            "@/common/types",
        ],
    ])("handles Windows source paths in %s", (filename, sourcePath, root, expected) => {
        expect(resolveSourceAlias(sourcePath, filename, root)).toBe(expected);
    });

    it("uses the configured source root", () => {
        const result = resolveSourceAlias(
            "../common/types",
            resolve(cwd, "nested/src/modules/file.ts"),
            cwd,
            "nested/src"
        );
        expect(result).toBe("@/common/types");
    });
});
