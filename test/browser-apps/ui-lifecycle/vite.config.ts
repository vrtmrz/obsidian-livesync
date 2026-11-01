import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(fixtureDirectory, "../../..");

export default defineConfig({
    root: fixtureDirectory,
    plugins: [svelte()],
    resolve: {
        alias: {
            "@": resolve(repositoryRoot, "src"),
        },
    },
    base: "./",
    build: {
        outDir: resolve(repositoryRoot, "_testdata/browser-ui-lifecycle"),
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(fixtureDirectory, "index.html"),
        },
    },
});
