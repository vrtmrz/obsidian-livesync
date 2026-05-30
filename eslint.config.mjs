import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import * as sveltePlugin from "eslint-plugin-svelte";

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
        "modules/octagonal-wheels/dist/**/*",

        // Sub-projects (Exclude from root linting as they have different environments)
        "src/apps/**/*",
        "utils/**/*",

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

        // Testing files (Simplified patterns)
        "**/*.test.ts",
        "**/*.unit.spec.ts",
        "**/test.ts",
        "**/tests.ts",
    ]),
    ...sveltePlugin.configs["flat/base"],
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            globals: { ...globals.browser, "PouchDB": "readonly" },
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        rules: {
            // Base rules (turned off in favour of TS specific versions or explicitly disabled).
            "no-unused-vars": "off",
            "no-unused-labels": "off",
            "no-prototype-builtins": "off",
            "require-await": "off",

            // TypeScript specific rules
            "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/require-await": "warn",
            "@typescript-eslint/no-misused-promises": "warn",
            "@typescript-eslint/no-floating-promises": "warn",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",

            // General rules
            "no-async-promise-executor": "warn",
            "no-constant-condition": ["error", { checkLoops: false }],

            // Plugin specific overrides (Pending review)
            "obsidianmd/rule-custom-message": "off",
            "obsidianmd/ui/sentence-case": "off",
        },
    },
    {
        files: ["**/*.svelte"],
        languageOptions: {
            parserOptions: {
                parser: tsParser,
            },
        },
        rules: {
            "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "obsidianmd/no-plugin-as-component": "off",
        },
    }
]);
