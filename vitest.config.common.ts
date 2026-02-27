import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import path from "path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { platform } from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const manifestJson = JSON.parse(fs.readFileSync("./manifest.json") + "");
const packageJson = JSON.parse(fs.readFileSync("./package.json") + "");
const updateInfo = JSON.stringify(fs.readFileSync("./updates.md") + "");
const prod = false;
const moduleAliasPlugin = {
    name: "module-alias",
    setup(build: any) {
        build.onResolve({ filter: /.(dev)(.ts|)$/ }, (args: any) => {
            // console.log(args.path);
            if (prod) {
                const prodTs = args.path.replace(".dev", ".prod");
                const statFile = prodTs.endsWith(".ts") ? prodTs : prodTs + ".ts";
                const realPath = path.join(args.resolveDir, statFile);
                console.log(`Checking ${statFile}`);
                if (fs.existsSync(realPath)) {
                    console.log(`Replaced ${args.path} with ${prodTs}`);
                    return {
                        path: realPath,
                        namespace: "file",
                    };
                }
            }
            return null;
        });
        build.onResolve({ filter: /.(platform)(.ts|)$/ }, (args: any) => {
            // console.log(args.path);
            if (prod) {
                const prodTs = args.path.replace(".platform", ".obsidian");
                const statFile = prodTs.endsWith(".ts") ? prodTs : prodTs + ".ts";
                const realPath = path.join(args.resolveDir, statFile);
                console.log(`Checking ${statFile}`);
                if (fs.existsSync(realPath)) {
                    console.log(`Replaced ${args.path} with ${prodTs}`);
                    return {
                        path: realPath,
                        namespace: "file",
                    };
                }
            }
            return null;
        });
    },
};
const externals = [
    "obsidian",
    "electron",
    "crypto",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
];
const define = {
    MANIFEST_VERSION: `"${manifestJson.version}"`,
    PACKAGE_VERSION: `"${packageJson.version}"`,
    UPDATE_INFO: `${updateInfo}`,
    global: "globalThis",
    hostPlatform: `"${platform}"`,
};
export default defineConfig({
    plugins: [
        moduleAliasPlugin,
        inlineWorkerPlugin({
            external: externals,
            treeShaking: true,
        }),
        svelte({
            preprocess: sveltePreprocess(),
            compilerOptions: { css: "injected", preserveComments: false },
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@lib": path.resolve(__dirname, "./src/lib/src"),
            src: path.resolve(__dirname, "./src"),
        },
    },
    esbuild: {
        define: define,
        target: "es2018",
        platform: "browser",
    },
    // define,
    server: {
        headers: {
            "Service-Worker-Allowed": "/",
        },
        port: 5173,
    },
});
