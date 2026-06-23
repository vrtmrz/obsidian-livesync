import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import * as sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import importAlias from "@dword-design/eslint-plugin-import-alias";
import { baseRules, ImportAliasRules, obsidianRules } from "./eslint.config.common.mjs";
const warnWhileDev = "off"; // Change to "warn" to enable warnings for rules that are currently disabled.
export default defineConfig([
    globalIgnores([
        // Build outputs and legacy files
        "**/build",
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

        // Sub-projects (Exclude from root linting as they have different environments)
        "src/apps",
        "utils",

        // Specific exclusions from common library (src/lib)
        "src/lib/coverage",
        "src/lib/browsertest",
        "src/lib/test",
        "src/lib/_tools",
        "src/lib/src/patches/pouchdb-utils",
        "src/lib/src/cli",
        "src/lib/src/services/implements/browser/**",
        "src/lib/src/services/implements/headless/**",
        "src/lib/src/API",

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
        // ignores:["src/lib/**/*.ts"], // Exclude library files from root linting (they have different environments and rules).
        languageOptions: {
            globals: { ...globals.browser, PouchDB: "readonly" },
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
                rootDir: "./",
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
]);
