import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { readFileSync } from "node:fs";
const packageJson = JSON.parse(readFileSync("../../../package.json", "utf-8"));
const manifestJson = JSON.parse(readFileSync("../../../manifest.json", "utf-8"));
// https://vite.dev/config/
const defaultExternal = [
    "obsidian",
    "electron",
    "crypto",
    "pouchdb-adapter-leveldb",
    "commander",
    "punycode",
    "node-datachannel",
    "node-datachannel/polyfill",
];
export default defineConfig({
    plugins: [svelte()],
    resolve: {
        alias: {
            "@lib/worker/bgWorker.ts": "../../lib/src/worker/bgWorker.mock.ts",
            "@lib/pouchdb/pouchdb-browser.ts": path.resolve(__dirname, "lib/pouchdb-node.ts"),
            // The CLI runs on Node.js; force AWS XML builder to its CJS Node entry
            // so Vite does not resolve the browser DOMParser-based XML parser.
            "@aws-sdk/xml-builder": path.resolve(
                __dirname,
                "../../../node_modules/@aws-sdk/xml-builder/dist-cjs/index.js"
            ),
            // Force fflate to the Node CJS entry; browser entry expects Web Worker globals.
            fflate: path.resolve(__dirname, "../../../node_modules/fflate/lib/node.cjs"),
            "@": path.resolve(__dirname, "../../"),
            "@lib": path.resolve(__dirname, "../../lib/src"),
            "../../src/worker/bgWorker.ts": "../../src/worker/bgWorker.mock.ts",
        },
    },

    base: "./",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
            input: {
                index: path.resolve(__dirname, "entrypoint.ts"),
            },
            external: (id) => {
                if (defaultExternal.includes(id)) return true;
                if (id.startsWith(".") || id.startsWith("/")) return false;
                if (id.startsWith("@/") || id.startsWith("@lib/")) return false;
                if (id.endsWith(".ts") || id.endsWith(".js")) return false;
                if (id === "fs" || id === "fs/promises" || id === "path" || id === "crypto" || id === "worker_threads")
                    return true;
                if (id.startsWith("pouchdb-")) return true;
                if (id.startsWith("node-datachannel")) return true;
                if (id.startsWith("node:")) return true;
                return false;
            },
        },
        lib: {
            entry: path.resolve(__dirname, "entrypoint.ts"),
            formats: ["cjs"],
            fileName: "index",
        },
    },
    define: {
        self: "globalThis",
        global: "globalThis",
        nonInteractive: "true",
        // localStorage: "undefined", // Prevent usage of localStorage in the CLI environment
        MANIFEST_VERSION: JSON.stringify(process.env.MANIFEST_VERSION || manifestJson.version || "0.0.0"),
        PACKAGE_VERSION: JSON.stringify(process.env.PACKAGE_VERSION || packageJson.version || "0.0.0"),
    },
});
