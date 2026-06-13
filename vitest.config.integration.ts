/**
 * @file vitest.config.integration.ts
 * @description Configuration for running database integration tests in Node.js against a real CouchDB instance
 * (e.g. testing streaming changes, database connectivity, and replication status checks).
 * This is executed via `npm run test:integration` during development and is run in the GitHub Actions `unit-ci` workflow.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vitest.config.common";

export default mergeConfig(
    viteConfig,
    defineConfig({
        resolve: {
            alias: {
                obsidian: "", // prevent accidental imports of obsidian types in integration tests
            },
        },
        test: {
            logHeapUsage: true,
            name: "integration-tests",
            include: ["**/*.integration.spec.ts", "**/*.integration.test.ts"],
            exclude: ["test/**", "src/apps/**/testdeno/**"],
        },
    })
);
