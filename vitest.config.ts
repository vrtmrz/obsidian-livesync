import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import path from "path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";
import { platform } from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defEnv = dotenv.config({ path: ".env" }).parsed;
const testEnv = dotenv.config({ path: ".test.env" }).parsed;
const env = Object.assign({}, defEnv, testEnv);
const debuggerEnabled = env?.ENABLE_DEBUGGER === "true";
const headless = !debuggerEnabled && env?.HEADLESS !== "false";
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
            obsidian: path.resolve(__dirname, "./test/harness/obsidian-mock.ts"),
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
    },
    test: {
        env: env,
        testTimeout: 10000,
        fileParallelism: false,
        isolate: true,
        watch: false,

        // environment: "browser",
        include: ["test/**/*.test.ts"],
        coverage: {
            include: ["src/**/*.ts", "src/lib/src/**/*.ts", "src/**/*.svelte"],
            exclude: ["**/*.test.ts", "src/lib/**"],
            provider: "v8",
            reporter: ["text", "json", "html"],
            // ignoreEmptyLines: true,
        },
        browser: {
            provider: playwright({
                launchOptions: {
                    args: ["--js-flags=--expose-gc"],
                    // chromiumSandbox: true,
                },
            }),
            enabled: true,
            screenshotFailures: false,
            instances: [
                {
                    execArgv: ["--js-flags=--expose-gc"],
                    browser: "chromium",
                    headless,

                    inspector: debuggerEnabled
                        ? {
                              waitForDebugger: true,
                              enabled: true,
                          }
                        : undefined,
                    printConsoleTrace: true,
                },
            ],
            headless,
            fileParallelism: false,
            ui: debuggerEnabled ? true : false,
        },
    },
});
