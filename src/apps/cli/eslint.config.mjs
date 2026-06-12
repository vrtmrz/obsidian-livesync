import { tsBaseConfig } from "../../../eslint.config.common.mjs";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores([
        "dist",
        "node_modules",
        "test",
        "testdeno"
    ]),
    {
        ...tsBaseConfig,
        languageOptions: {
            ...tsBaseConfig.languageOptions,
            globals: { ...globals.node },
        },
    }
]);
