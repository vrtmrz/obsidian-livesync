import importAlias from "@dword-design/eslint-plugin-import-alias";
import tsParser from "@typescript-eslint/parser";
// import obsidianmd from "eslint-plugin-obsidianmd";
// const obsidianRules = obsidianmd.configs.recommended.find((config) => config.rules)?.rules || {};
// console.dir(obsidianRules);
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import { baseRules, CommunityReviewRecommendedRules, ImportAliasRules } from "../../../eslint.config.common.mjs";
export default defineConfig([
    globalIgnores([
        "dist",
        "node_modules",
        "test",
        "testdeno",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/test.ts",
        "**/tests.ts",
        "**/*.js",
        "**/*.mjs",
    ]),
    ...tseslint.configs.recommendedTypeChecked,
    importAlias.configs.recommended,
    {
        files: ["**/*.ts"],
        // ignores:["src/lib/**/*.ts"], // Exclude library files from root linting (they have different environments and rules).
        languageOptions: {
            globals: { ...globals.node, PouchDB: "readonly" },
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
            // ...obsidianRules,
            // -- Project specific rules
            ...ImportAliasRules("../../../"),
            // cli specific rules
            "@typescript-eslint/no-this-alias": "off", // This rule is often inconvenient in CLI code where `this` is commonly used in various contexts, including callbacks and class methods.
            ...CommunityReviewRecommendedRules,
        },
    },
]);
