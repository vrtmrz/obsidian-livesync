import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import * as sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import importAlias from "@dword-design/eslint-plugin-import-alias";
import { baseRules, ImportAliasRules, obsidianRules } from "./eslint.config.common.mjs";
const warnWhileDev = "off"; // Change to "warn" to enable warnings for rules that are currently disabled.
const lintProjects = [
    "./tsconfig.json",
    "./src/apps/browser/tsconfig.json",
    "./src/apps/cli/tsconfig.json",
    "./src/apps/webapp/tsconfig.json",
    "./src/apps/webpeer/tsconfig.app.json",
    "./src/apps/webpeer/tsconfig.node.json",
];
export default defineConfig([
    globalIgnores([
        // Build outputs and legacy files
        "**/build",
        "**/dist/**",
        "coverage",
        "**/main.js",
        "main_org.js",
        "pouchdb-browser.js",
        "version-bump.mjs",
        "package.json",
        "**/*.json",
        "**/.eslintrc.js.bak",
        // Files from linked dependencies (those files should not exist for most people).
        "modules/octagonal-wheels/dist",

        // Sub-project tooling with its own environment
        "utils",

        // Config files and build scripts
        "**/jest.config.js",
        "**/rollup.config.js",
        "**/esbuild.config.mjs",
        "**/terser.*.mjs",
        ".prettierrc.*.mjs",
        ".prettierrc.mjs",
        "*.config.mjs",
        "vite.*",
        "vitest.*",
        // Testing files (Simplified patterns)
        "test/**",
        "**/test/**",
        "src/apps/_test/**",
        "src/apps/cli/testdeno/**",
        "**/*.test.ts",
        "**/*.unit.spec.ts",
        "**/test.ts",
        "**/tests.ts",
    ]),
    ...sveltePlugin.configs["flat/base"],
    ...obsidianmd.configs.recommended,
    importAlias.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            globals: { ...globals.browser, PouchDB: "readonly" },
            parser: tsParser,
            parserOptions: {
                project: lintProjects,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        rules: {
            ...baseRules,
            ...obsidianRules,
            // -- Project specific rules
            ...ImportAliasRules("."),
        },
    },
    {
        files: ["**/*.svelte"],
        languageOptions: {
            globals: { ...globals.browser, PouchDB: "readonly" },
            parser: svelteParser,
            parserOptions: {
                parser: tsParser,
                project: lintProjects,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: [".svelte"],
            },
        },
        rules: {
            // no-unused-vars:
            // Svelte template's declarations have a lot of false positives and the rule is not worth the effort to fix at this time.
            // it may improve in the future with some options as like   ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],]
            "no-unused-vars": "off",
            ...obsidianRules,
            "obsidianmd/no-plugin-as-component": "off",
            ...ImportAliasRules("."),
        },
    },
    {
        files: ["src/apps/**/*.ts"],
        rules: {
            // Platform adapters implement asynchronous contracts even when a local operation is synchronous.
            "@typescript-eslint/require-await": "off",
            // Keep existing application code visible without making gradual type tightening a release blocker.
            "@typescript-eslint/no-base-to-string": "warn",
            "@typescript-eslint/no-unnecessary-type-assertion": "warn",
            "@typescript-eslint/restrict-template-expressions": "warn",
        },
    },
    {
        files: ["src/apps/browser/**/*.{ts,svelte}", "src/apps/webapp/**/*.ts"],
        rules: {
            // Browser applications use the DOM rather than Obsidian's DOM extensions.
            "obsidianmd/prefer-create-el": "off",
            "obsidianmd/prefer-active-doc": "off",
        },
    },
]);
