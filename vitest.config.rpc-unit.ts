/**
 * @file vitest.config.rpc-unit.ts
 * @description Configuration for running RPC-specific unit tests (such as RpcRoom and transport layers) in Node.js,
 * enforcing coverage thresholds on the RPC sub-module.
 * This can be run manually to verify RPC-specific coverage, or is matched by the glob patterns in `npm run test:unit`.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vitest.config.common";

export default mergeConfig(
    viteConfig,
    defineConfig({
        resolve: {
            alias: {
                obsidian: "",
            },
        },
        test: {
            name: "rpc-unit-tests",
            include: ["src/lib/src/rpc/**/*.unit.spec.ts"],
            exclude: ["test/**"],
            coverage: {
                include: ["src/lib/src/rpc/**/*.ts"],
                exclude: ["**/*.unit.spec.ts", "**/index.ts"],
                provider: "v8",
                reporter: ["text", "json", "html", ["text", { file: "coverage-rpc-text.txt" }]],
                thresholds: {
                    lines: 90,
                    functions: 90,
                    branches: 75,
                    statements: 90,
                },
            },
        },
    })
);
