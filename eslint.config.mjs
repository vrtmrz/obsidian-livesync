import typescriptEslint from "@typescript-eslint/eslint-plugin";
import svelte from "eslint-plugin-svelte";
import _import from "eslint-plugin-import";
import { fixupPluginRules } from "@eslint/compat";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: [
            "**/node_modules/*",
            "**/jest.config.js",
            "src/lib/coverage",
            "src/lib/browsertest",
            "**/test.ts",
            "**/tests.ts",
            "**/**test.ts",
            "**/**.test.ts",
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
            "src/lib/src/cli",
            "**/main.js",
            "src/lib/apps/webpeer/*",
            ".prettierrc.*.mjs",
            ".prettierrc.mjs",
            "*.config.mjs"
        ],
    },
    ...compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended"
    ),
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
            svelte,
            import: fixupPluginRules(_import),
        },

        languageOptions: {
            parser: tsParser,
            ecmaVersion: 5,
            sourceType: "module",

            parserOptions: {
                project: ["tsconfig.json"],
            },
        },

        rules: {
            "no-unused-vars": "off",

            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "none",
                },
            ],

            "no-unused-labels": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "no-prototype-builtins": "off",
            "@typescript-eslint/no-empty-function": "off",
            "require-await": "error",
            "@typescript-eslint/require-await": "warn",
            "@typescript-eslint/no-misused-promises": "warn",
            "@typescript-eslint/no-floating-promises": "warn",
            "no-async-promise-executor": "warn",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",

            "no-constant-condition": [
                "error",
                {
                    checkLoops: false,
                },
            ],
        },
    },
];

