import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import * as sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import importAlias from "@dword-design/eslint-plugin-import-alias";
import { tsBaseConfig, svelteBaseConfig } from "./eslint.config.common.mjs";
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
        ...tsBaseConfig,
        languageOptions: {
            ...tsBaseConfig.languageOptions,
            globals: { ...globals.browser, PouchDB: "readonly" },
        },
        plugins: {
            ...tsBaseConfig.plugins,
        },
        rules: {
            ...tsBaseConfig.rules,
            // -- Obsidian rules
            "obsidianmd/no-unsupported-api": warnWhileDev,
            "obsidianmd/rule-custom-message": "off",
            "obsidianmd/ui/sentence-case": "off",
            "obsidianmd/no-plugin-as-component": "off",
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
        ...svelteBaseConfig,
        languageOptions: {
            ...svelteBaseConfig.languageOptions,
            globals: { ...globals.browser, PouchDB: "readonly" },
        },
        plugins: {
            ...svelteBaseConfig.plugins,
        },
        rules: {
            ...svelteBaseConfig.rules,
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
