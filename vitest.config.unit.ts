import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vitest.config.common";

const importOnlyFiles = ["**/encryption/encryptHKDF.ts"];
export default mergeConfig(
    viteConfig,
    defineConfig({
        resolve: {
            alias: {
                obsidian: "", // prevent accidental imports of obsidian types in unit tests,
            },
        },
        test: {
            name: "unit-tests",
            include: ["**/*unit.test.ts", "**/*.unit.spec.ts"],
            exclude: ["test/**"],
            coverage: {
                include: ["src/**/*.ts"],
                exclude: [
                    "**/*.test.ts",
                    "src/lib/**/*.test.ts",
                    "**/_*",
                    "src/lib/apps",
                    "src/lib/src/cli",
                    "**/*_obsolete.ts",
                    ...importOnlyFiles,
                ],
                provider: "v8",
                reporter: ["text", "json", "html"],
            },
        },
    })
);
