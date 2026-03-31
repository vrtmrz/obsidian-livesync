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
    "chokidar",
    "punycode",
    "werift",
];
// Polyfill FileReader at the very top of the CJS bundle. octagonal-wheels uses
// FileReader for base64 conversion when Uint8Array.toBase64 (TC39 proposal) is
// unavailable. Node.js has neither, so we inject a minimal FileReader shim before
// any module-scope code evaluates.
const fileReaderPolyfillBanner = `
if (typeof globalThis.FileReader === "undefined") {
    globalThis.FileReader = class FileReader {
        constructor() { this.result = null; this.onload = null; this.onerror = null; }
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                var b64 = require("buffer").Buffer.from(buf).toString("base64");
                this.result = "data:" + (blob.type || "application/octet-stream") + ";base64," + b64;
                if (this.onload) this.onload({ target: this });
            }).catch((err) => { if (this.onerror) this.onerror({ target: this, error: err }); });
        }
    };
}
`;

function injectBanner(): import("vite").Plugin {
    return {
        name: "inject-banner",
        generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === "chunk" && chunk.fileName.startsWith("entrypoint")) {
                    // Insert after the shebang line if present, otherwise at the top.
                    if (chunk.code.startsWith("#!")) {
                        const newline = chunk.code.indexOf("\n");
                        chunk.code = chunk.code.slice(0, newline + 1) + fileReaderPolyfillBanner + chunk.code.slice(newline + 1);
                    } else {
                        chunk.code = fileReaderPolyfillBanner + chunk.code;
                    }
                }
            }
        },
    };
}

export default defineConfig({
    plugins: [svelte(), injectBanner()],
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
                if (id.startsWith("werift")) return true;
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
