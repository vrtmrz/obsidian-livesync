import { tsBaseConfig, svelteBaseConfig } from "../../../eslint.config.common.mjs";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import * as sveltePlugin from "eslint-plugin-svelte";

export default defineConfig([
    globalIgnores([
        "dist",
        "node_modules"
    ]),
    ...sveltePlugin.configs["flat/base"],
    {
        ...tsBaseConfig,
        files: ["src/**/*.ts"],
        languageOptions: {
            ...tsBaseConfig.languageOptions,
            globals: { ...globals.browser },
        },
    },
    {
        ...svelteBaseConfig,
        files: ["src/**/*.svelte"],
        languageOptions: {
            ...svelteBaseConfig.languageOptions,
            globals: { ...globals.browser },
        },
    },
]);
