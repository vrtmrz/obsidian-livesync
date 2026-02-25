import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vitest.config.common";

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            name: "unit-tests",
            include: ["**/*unit.test.ts", "**/*.unit.spec.ts"],
            exclude: ["test/**"],
            coverage: {
                include: ["src/**/*.ts"],
                exclude: ["**/*.test.ts", "src/lib/**/*.test.ts", "**/_*", "src/lib/apps", "src/lib/src/cli"],
                provider: "v8",
                reporter: ["text", "json", "html"],
            },
        },
    })
);
