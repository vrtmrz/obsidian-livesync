import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { readFileSync } from "node:fs";
const packageJson = JSON.parse(readFileSync("../../../package.json", "utf-8"));
const manifestJson = JSON.parse(readFileSync("../../../manifest.json", "utf-8"));
// https://vite.dev/config/
export default defineConfig({
    plugins: [svelte()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "../../"),
            "@lib": path.resolve(__dirname, "../../lib/src"),
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
            external:[
                "crypto"
            ]
        },
    },
    define: {
        MANIFEST_VERSION: JSON.stringify(process.env.MANIFEST_VERSION || manifestJson.version || "0.0.0"),
        PACKAGE_VERSION: JSON.stringify(process.env.PACKAGE_VERSION || packageJson.version || "0.0.0"),
    },
    server: {
        port: 3000,
        open: true,
    },
});
