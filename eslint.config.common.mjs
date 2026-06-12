import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import svelteParser from "svelte-eslint-parser";

const warnWhileDev = "off";

export const tsBaseRules = {
    // -- Base rules (turned off in favour of TS specific versions or explicitly disabled).
    "no-unused-vars": "off",
    "no-unused-labels": "off",
    "no-prototype-builtins": "off",
    "require-await": "off",
    // -- TypeScript specific rules
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-redundant-type-constituents": "warn",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-deprecated": warnWhileDev,
    "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",

    // -- General rules
    "no-async-promise-executor": warnWhileDev,
    "no-constant-condition": ["error", { checkLoops: false }],
    "no-undef": "off",
};

export const tsBaseConfig = {
    files: ["**/*.ts"],
    plugins: {
        "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
        parser: tsParser,
        parserOptions: {
            project: "./tsconfig.json",
            rootDir: "./",
        },
    },
    rules: tsBaseRules,
};

export const svelteBaseConfig = {
    files: ["**/*.svelte"],
    plugins: {
        "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
        parser: svelteParser,
        parserOptions: {
            parser: tsParser,
            extraFileExtensions: [".svelte"],
            rootDir: "./",
        },
    },
    rules: {
        "no-unused-vars": "off",
    },
};
