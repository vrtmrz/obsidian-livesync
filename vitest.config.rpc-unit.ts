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
