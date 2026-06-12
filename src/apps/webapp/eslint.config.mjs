import importAlias from "@dword-design/eslint-plugin-import-alias";
import tsParser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import { baseRules, CommunityReviewRecommendedRules, ImportAliasRules } from "../../../eslint.config.common.mjs";

export default defineConfig([
    globalIgnores([
        "dist",
        "node_modules",
        "test",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/test.ts",
        "**/tests.ts",
        "**/*.js",
        "**/*.mjs",
        "vite.config.ts",
        "playwright.config.ts",
    ]),
    ...tseslint.configs.recommendedTypeChecked,
    importAlias.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            globals: { ...globals.browser, PouchDB: "readonly" },
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
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
        },
    },
]);
