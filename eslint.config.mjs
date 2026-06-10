import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import * as sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import importAlias from "@dword-design/eslint-plugin-import-alias";
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
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        rules: {
            // -- Base rules (turned off in favour of TS specific versions or explicitly disabled).
            "no-unused-vars": "off",
            "no-unused-labels": "off",
            "no-prototype-builtins": "off",
            "require-await": "off",
            // -- TypeScript specific rules (Gradual adoption of stricter rules, currently set to 'warn' for a while).
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-redundant-type-constituents": "warn",
            // -- TypeScript specific rules
            //  @typescript-eslint/no-unsafe-* rules and @typescript-eslint/no-explicit-any:
            //  This project contains a lot of library-sh code where the use of `any` is often necessary and justified.
            //  Rules is now set to 'off' for a while.
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            // -- Reasonable rules.
            "@typescript-eslint/no-deprecated": warnWhileDev,
            "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/require-await": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",

            // -- Obsidian rules
            // obsidianmd/no-unsupported-api: usually this project checks for API support at runtime, so this rule is not critical but can be helpful to catch potential issues.
            "obsidianmd/no-unsupported-api": warnWhileDev,

            // -- General rules
            "no-async-promise-executor": warnWhileDev,
            "no-constant-condition": ["error", { checkLoops: false }],
            // -- Disabled rules
            // no-undef: This option breaks the global declarations for the library files and is not worth the effort to fix at this time.
            "no-undef": "off",

            // -- Plugin specific overrides
            "obsidianmd/rule-custom-message": "off",
            "obsidianmd/ui/sentence-case": "off",
            "obsidianmd/no-plugin-as-component": "off",

            // -- Temporary overrides for migration
            "obsidianmd/no-static-styles-assignment": "off",

            // -- Project specific rules
            "@dword-design/import-alias/prefer-alias": [
                "error",
                {
                    aliasForSubpaths: true,
                    alias: {
                        "@": "./src",
                        "@lib": "./src/lib/src",
                    },
                },
            ],
        },
    },
    {
        files: ["**/*.svelte"],
        languageOptions: {
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
            "obsidianmd/no-plugin-as-component": "off",
            "obsidianmd/ui/sentence-case": "off",
            "@dword-design/import-alias/prefer-alias": [
                "error",
                {
                    aliasForSubpaths: true,
                    alias: {
                        "@": "./src",
                        "@lib": "./src/lib/src",
                    },
                },
            ],
        },
    },
]);
