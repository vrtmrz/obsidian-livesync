//@ts-check

import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import fs from "node:fs";
// import terser from "terser";
import { minify } from "terser";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import { terserOption } from "./terser.config.mjs";

const prod = process.argv[2] === "production";
const keepTest = !prod;

const manifestJson = JSON.parse(fs.readFileSync("./manifest.json") + "");
const packageJson = JSON.parse(fs.readFileSync("./package.json") + "");
const updateInfo = JSON.stringify(fs.readFileSync("./updates.md") + "");

/** @type esbuild.Plugin[] */
const plugins = [
    {
        name: "my-plugin",
        setup(build) {
            let count = 0;
            build.onEnd(async (result) => {
                if (count++ === 0) {
                    console.log("first build:", result);
                } else {
                    console.log("subsequent build:");
                }
                if (prod) {
                    console.log("Performing terser");
                    const src = fs.readFileSync("./main_org.js").toString();
                    // @ts-ignore
                    const ret = await minify(src, terserOption);
                    if (ret && ret.code) {
                        fs.writeFileSync("./main.js", ret.code);
                    }
                    console.log("Finished terser");
                } else {
                    fs.copyFileSync("./main_org.js", "./main.js");
                }
            });
        },
    },
];

const externals = ["obsidian", "electron", "crypto", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr"];
const context = await esbuild.context({
    banner: {
        js: "// Leave it all to terser",
    },
    entryPoints: ["src/main.ts"],
    bundle: true,
    define: {
        MANIFEST_VERSION: `"${manifestJson.version}"`,
        PACKAGE_VERSION: `"${packageJson.version}"`,
        UPDATE_INFO: `${updateInfo}`,
        global: "window",
    },
    external: externals,
    // minifyWhitespace: true,
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    platform: "browser",
    sourcemap: prod ? false : "inline",
    treeShaking: false,
    outfile: "main_org.js",
    mainFields: ["browser", "module", "main"],
    minifyWhitespace: false,
    minifySyntax: false,
    minifyIdentifiers: false,
    minify: false,
    dropLabels: prod && !keepTest ? ["TEST", "DEV"] : [],
    // keepNames: true,
    plugins: [
        inlineWorkerPlugin({
            external: externals,
            treeShaking: true,
        }),
        sveltePlugin({
            preprocess: sveltePreprocess(),
            compilerOptions: { css: "injected", preserveComments: false },
        }),
        ...plugins,
    ],
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}
