import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import copy from "rollup-plugin-copy";
import path from "path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { platform } from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const manifestJson = JSON.parse(fs.readFileSync("./manifest.json") + "");
const packageJson = JSON.parse(fs.readFileSync("./package.json") + "");
const updateInfo = JSON.stringify(fs.readFileSync("./updates.md") + "");

// const moduleAliasPlugin = {
//     name: "module-alias",
//     setup(build: any) {
//         build.onResolve({ filter: /.(dev)(.ts|)$/ }, (args: any) => {
//             // console.log(args.path);
//             if (prod) {
//                 const prodTs = args.path.replace(".dev", ".prod");
//                 const statFile = prodTs.endsWith(".ts") ? prodTs : prodTs + ".ts";
//                 const realPath = path.join(args.resolveDir, statFile);
//                 console.log(`Checking ${statFile}`);
//                 if (fs.existsSync(realPath)) {
//                     console.log(`Replaced ${args.path} with ${prodTs}`);
//                     return {
//                         path: realPath,
//                         namespace: "file",
//                     };
//                 }
//             }
//             return null;
//         });
//         build.onResolve({ filter: /.(platform)(.ts|)$/ }, (args: any) => {
//             // console.log(args.path);
//             if (prod) {
//                 const prodTs = args.path.replace(".platform", ".obsidian");
//                 const statFile = prodTs.endsWith(".ts") ? prodTs : prodTs + ".ts";
//                 const realPath = path.join(args.resolveDir, statFile);
//                 console.log(`Checking ${statFile}`);
//                 if (fs.existsSync(realPath)) {
//                     console.log(`Replaced ${args.path} with ${prodTs}`);
//                     return {
//                         path: realPath,
//                         namespace: "file",
//                     };
//                 }
//             }
//             return null;
//         });
//     },
// };
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
const PATHS_TEST_INSTALL = process.env?.PATHS_TEST_INSTALL || "";
const PATH_TEST_INSTALL = PATHS_TEST_INSTALL.split(path.delimiter)
    .map((p) => p.trim())
    .filter((p) => p.length);
if (PATH_TEST_INSTALL) {
    console.log(`Built files will be copied to ${PATH_TEST_INSTALL}`);
} else {
    console.log(
        "Development build: You can install the plug-in to Obsidian for testing by exporting the PATHS_TEST_INSTALL environment variable with the paths to your vault plugins directories separated by your system path delimiter (':' on Unix, ';' on Windows)."
    );
}
import { terserOption } from "./terser_vite.config";
export default defineConfig(({ mode }) => {

    const prod = mode === "production" || mode === "original";
    let minify = prod ? "terser" : false;
    let outFile = `main_vite.${prod ? "prod" : "dev"}.js`;
    if (mode == "original") {
        console.log("Building original unminified version");
        minify = false;
        outFile = `main_vite.original.js`;
    }
    outFile = `main.js`;
    return {
        plugins: [
            // moduleAliasPlugin,
            inlineWorkerPlugin({
                external: externals,
                treeShaking: true,
            }),
            svelte({
                preprocess: sveltePreprocess(),
                compilerOptions: { css: "injected", preserveComments: false },
            }),

            copy({
                targets: ["manifest.json", "main.js", "styles.css"]
                    .map((file) => PATH_TEST_INSTALL.map((dest) => ({ src: file, dest: dest })))
                    .flat(),
                // Copy after the build is complete
                hook: "writeBundle",
                verbose: true,
            }),
        ],

        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
                "@lib": path.resolve(__dirname, "./src/lib/src"),
                src: path.resolve(__dirname, "./src"),
            },
        },
        build: {
            target: 'es2018',
            commonjsOptions: {},
            lib: {
                entry: path.resolve(__dirname, "src/main.ts"),
                name: "main",
                fileName: () => outFile,
                formats: ["cjs"], //
            },
            rollupOptions: {
                external: externals,
                output: {
                    globals: {
                        obsidian: "obsidian",
                        electron: "electron",
                    },
                    entryFileNames: outFile,
                    inlineDynamicImports: true,
                    manualChunks: undefined,
                },
            },
            minify: minify ? "terser" : false,
            // minify:false,
            terserOptions: terserOption,
            outDir: ".",
            emptyOutDir: false,
            sourcemap: prod ? false : "hidden",
        },
        define: define,
        worker: {
            format: "iife",
        },
    }
})
