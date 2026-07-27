/**
 * @file vitest.config.unit.ts
 * @description Configuration for running unit tests in Node.js (excluding browser harnesses, E2E, and database integration tests).
 * This is executed during local development via `npm run test:unit` (or with coverage via `npm run test:unit:coverage`), and automatically in the GitHub Actions `unit-ci` workflow.
 */
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
            exclude: ["node_modules/**", "test/**", "src/apps/**/testdeno/**"],
            coverage: {
                include: ["src/**/*.ts"],
                exclude: [
                    "**/*.test.ts",
                    "**/*unit.test.ts",
                    "**/*.unit.spec.ts",
                    "test/**",
                    "**/_*",
                    "src/apps/**/testdeno/**",
                    "**/*_obsolete.ts",
                    ...importOnlyFiles,
                ],
                provider: "v8",
                reporter: ["text", "json", "html", ["text", { file: "coverage-text.txt" }]],
            },
        },
    })
);
