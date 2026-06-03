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
            logHeapUsage: true,
            // maxConcurrency: 2,
            name: "unit-tests",
            include: ["**/*unit.test.ts", "**/*.unit.spec.ts"],
            exclude: ["test/**", "src/apps/**/testdeno/**"],
            coverage: {
                include: ["src/**/*.ts"],
                exclude: [
                    "**/*.test.ts",
                    "**/*unit.test.ts",
                    "**/*.unit.spec.ts",
                    "test/**",
                    "src/lib/**/*.test.ts",
                    "**/_*",
                    "src/apps/**/testdeno/**",
                    // "src/apps/**",
                    // "src/cli/**",
                    "src/lib/src/cli/**",
                    "**/*_obsolete.ts",
                    ...importOnlyFiles,
                ],
                provider: "v8",
                reporter: ["text", "json", "html", ["text", { file: "coverage-text.txt" }]],
            },
        },
    })
);
