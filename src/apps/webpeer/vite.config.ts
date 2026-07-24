import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { path } from "@vrtmrz/livesync-commonlib/node";
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
                index: "index.html",
                // uitest: "uitest.html",
            },
        },
    },
});
