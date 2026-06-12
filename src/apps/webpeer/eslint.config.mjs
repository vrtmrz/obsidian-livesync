import importAlias from "@dword-design/eslint-plugin-import-alias";
import tsParser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import * as sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import { baseRules, CommunityReviewRecommendedRules, ImportAliasRules } from "../../../eslint.config.common.mjs";

export default defineConfig([
    globalIgnores([
        "dist",
        "node_modules",
        "vite.config.ts",
        "svelte.config.js",
        "**/*.js",
        "**/*.mjs",
    ]),
    ...tseslint.configs.recommendedTypeChecked,
    ...sveltePlugin.configs["flat/base"],
    importAlias.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            globals: { ...globals.browser, PouchDB: "readonly" },
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.app.json",
                rootDir: "../../../",
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        rules: {
            ...baseRules,
            ...ImportAliasRules("../../../"),
            ...CommunityReviewRecommendedRules,
            "no-restricted-globals": "off",
        },
    },
    {
        files: ["src/**/*.svelte"],
        languageOptions: {
            globals: { ...globals.browser, PouchDB: "readonly" },
            parser: svelteParser,
            parserOptions: {
                parser: tsParser,
                extraFileExtensions: [".svelte"],
                project: "./tsconfig.app.json",
                rootDir: "../../../",
            },
        },
        rules: {
            "no-unused-vars": "off",
            ...ImportAliasRules("../../../"),
            ...CommunityReviewRecommendedRules,
            "no-restricted-globals": "off",
        },
    },
]);
