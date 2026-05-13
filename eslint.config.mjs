import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import * as sveltePlugin from "eslint-plugin-svelte";

export default defineConfig([
    globalIgnores([
        "**/node_modules/*",
        "**/jest.config.js",
        "src/lib/coverage",
        "src/lib/browsertest",
        "**/test.ts",
        "**/tests.ts",
        "**/**test.ts",
        "**/**.test.ts",
        "**/*.unit.spec.ts",
        "**/esbuild.*.mjs",
        "**/terser.*.mjs",
        "**/node_modules",
        "**/build",
        "**/.eslintrc.js.bak",
        "src/lib/src/patches/pouchdb-utils",
        "**/esbuild.config.mjs",
        "**/rollup.config.js",
        "modules/octagonal-wheels/rollup.config.js",
        "modules/octagonal-wheels/dist/**/*",
        "src/lib/test",
        "src/lib/_tools",
        "src/lib/src/cli",
        "**/main.js",
        "src/apps/**/*",
        ".prettierrc.*.mjs",
        ".prettierrc.mjs",
        "*.config.mjs",
    ]),
    ...sveltePlugin.configs["flat/base"],
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            globals: { ...globals.browser },
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
            "no-unused-labels": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "no-prototype-builtins": "off",
            "@typescript-eslint/no-empty-function": "off",
            "require-await": "error",
            "obsidianmd/rule-custom-message": "off", // Temporary
            "obsidianmd/ui/sentence-case": "off", // Temporary
            "@typescript-eslint/require-await": "warn",
            "@typescript-eslint/no-misused-promises": "warn",
            "@typescript-eslint/no-floating-promises": "warn",
            "no-async-promise-executor": "warn",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",
            "no-constant-condition": ["error", { checkLoops: false }],
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
            "obsidianmd/no-plugin-as-component": "off", // Temporary
        },
    },
]);
