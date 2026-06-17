import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import istanbul from "vite-plugin-istanbul";
import path from "node:path";
import { readFileSync } from "node:fs";
const packageJson = JSON.parse(readFileSync("../../../package.json", "utf-8"));
const manifestJson = JSON.parse(readFileSync("../../../manifest.json", "utf-8"));
const enableCoverage = process.env.PW_COVERAGE === "1";
const repoRoot = path.resolve(__dirname, "../../..");
// https://vite.dev/config/
export default defineConfig({
    plugins: [
        svelte(),
        ...(enableCoverage
            ? [
                  istanbul({
                      cwd: repoRoot,
                      include: ["src/**/*.ts", "src/**/*.svelte"],
                      exclude: [
                          "node_modules",
                          "dist",
                          "test",
                          "coverage",
                          "src/apps/webapp/test/**",
                          "playwright.config.ts",
                          "vite.config.ts",
                          "**/*.spec.ts",
                          "**/*.test.ts",
                      ],
                      extension: [".js", ".ts", ".svelte"],
                      requireEnv: false,
                      cypress: false,
                      checkProd: false,
                  }),
              ]
            : []),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "../../"),
            "@lib": path.resolve(__dirname, "../../lib/src"),
            obsidian: path.resolve(__dirname, "../../../test/harness/obsidian-mock.ts"),
        },
    },
    base: "./",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
            // test.html is used by the Playwright dev-server; include it here
            // so the production build doesn't emit warnings about unused inputs.
            input: {
                index: path.resolve(__dirname, "index.html"),
                webapp: path.resolve(__dirname, "webapp.html"),
                test: path.resolve(__dirname, "test.html"),
            },
            external: ["crypto"],
        },
    },
    define: {
        MANIFEST_VERSION: JSON.stringify(process.env.MANIFEST_VERSION || manifestJson.version || "0.0.0"),
        PACKAGE_VERSION: JSON.stringify(process.env.PACKAGE_VERSION || packageJson.version || "0.0.0"),
        global: "globalThis",
        hostPlatform: JSON.stringify(process.platform || "linux"),
    },
    server: {
        port: 3000,
        open: true,
    },
});
