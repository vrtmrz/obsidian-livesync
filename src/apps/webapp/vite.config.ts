import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
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
// https://vite.dev/config/
export default defineConfig({
    plugins: [svelte()],
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
            input: {
                index: path.resolve(__dirname, "index.html"),
                webapp: path.resolve(__dirname, "webapp.html"),
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
