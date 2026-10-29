import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, path } from "@vrtmrz/livesync-commonlib/node";
import { readVersion } from "../readVersion";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const packageVersion = readVersion(path.resolve(repoRoot, "package.json"));
const manifestVersion = readVersion(path.resolve(repoRoot, "manifest.json"));
// https://vite.dev/config/
export default defineConfig({
    plugins: [svelte()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "../../"),
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
    },
    server: {
        port: 3000,
        open: true,
    },
});
