import communityConfig from "./eslint.community.config.mjs";
import { globalIgnores } from "eslint/config";

export default [
    globalIgnores(["**/*.integration.spec.ts", "**/*.integration.test.ts"]),
    ...communityConfig,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.community-review-node-next.probe.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
