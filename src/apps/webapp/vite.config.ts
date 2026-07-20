import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import istanbul from "vite-plugin-istanbul";
import { fileURLToPath, fs, path } from "@vrtmrz/livesync-commonlib/node";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function readVersion(filePath: string): string | undefined {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
        return undefined;
    }
    return typeof parsed.version === "string" ? parsed.version : undefined;
}

const packageVersion = readVersion(path.resolve(repoRoot, "package.json"));
const manifestVersion = readVersion(path.resolve(repoRoot, "manifest.json"));
const enableCoverage = process.env.PW_COVERAGE === "1";
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
            obsidian: path.resolve(__dirname, "./obsidianMock.ts"),
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
        MANIFEST_VERSION: JSON.stringify(process.env.MANIFEST_VERSION || manifestVersion || "0.0.0"),
        PACKAGE_VERSION: JSON.stringify(process.env.PACKAGE_VERSION || packageVersion || "0.0.0"),
        global: "globalThis",
        hostPlatform: JSON.stringify(process.platform || "linux"),
    },
    server: {
        port: 3000,
        open: true,
    },
});
