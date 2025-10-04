//@ts-check

import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import sveltePlugin from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import fs from "node:fs";
// import terser from "terser";
import { minify } from "terser";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import { terserOption } from "./terser.config.mjs";
import path from "node:path";

const prod = process.argv[2] === "production";
const keepTest = true; //!prod;

const manifestJson = JSON.parse(fs.readFileSync("./manifest.json") + "");
const packageJson = JSON.parse(fs.readFileSync("./package.json") + "");
const updateInfo = JSON.stringify(fs.readFileSync("./updates.md") + "");

const PATHS_TEST_INSTALL = process.env?.PATHS_TEST_INSTALL || "";
const PATH_TEST_INSTALL = PATHS_TEST_INSTALL.split(path.delimiter).map(p => p.trim()).filter(p => p.length);
if (!prod) {
    if (PATH_TEST_INSTALL) {
        console.log(`Built files will be copied to ${PATH_TEST_INSTALL}`);
    } else {
        console.log("Development build: You can install the plug-in to Obsidian for testing by exporting the PATHS_TEST_INSTALL environment variable with the paths to your vault plugins directories separated by your system path delimiter (':' on Unix, ';' on Windows).");
    }
} else {
    console.log("Production build");
}

const moduleAliasPlugin = {
    name: "module-alias",
    setup(build) {
        build.onResolve({ filter: /.(dev)(.ts|)$/ }, (args) => {
            // console.log(args.path);
            if (prod) {
                let prodTs = args.path.replace(".dev", ".prod");
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
        build.onResolve({ filter: /.(platform)(.ts|)$/ }, (args) => {
            // console.log(args.path);
            if (prod) {
                let prodTs = args.path.replace(".platform", ".obsidian");
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

/** @type esbuild.Plugin[] */
const plugins = [
    {
        name: "my-plugin",
        setup(build) {
            let count = 0;
            build.onEnd(async (result) => {
                if (count++ === 0) {
                    console.log("first build:");
                    if (prod) {
                        console.log("MetaFile:");
                        if (result.metafile) {
                            fs.writeFileSync("meta.json", JSON.stringify(result.metafile));
                            let text = await esbuild.analyzeMetafile(result.metafile, {
                                verbose: true,
                            });
                            // console.log(text);
                        }
                    }
                } else {
                    console.log("subsequent build:");
                }
                const filename = `meta-${prod ? "prod" : "dev"}.json`;
                await fs.promises.writeFile(filename, JSON.stringify(result.metafile, null, 2));
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
                if (PATH_TEST_INSTALL) {
                    for (const installPath of PATH_TEST_INSTALL) {
                        const realPath = path.resolve(installPath);
                        console.log(`Copying built files to ${realPath}`);
                        if (!fs.existsSync(realPath)) {
                            console.warn(`Test install path ${installPath} does not exist`);
                            continue;
                        }
                        const manifestX = JSON.parse(fs.readFileSync("./manifest.json") + "");
                        manifestX.version = manifestJson.version + "." + Date.now();
                        fs.writeFileSync(path.join(installPath, "manifest.json"), JSON.stringify(manifestX, null, 2));
                        fs.copyFileSync("./main.js", path.join(installPath, "main.js"));
                        fs.copyFileSync("./styles.css", path.join(installPath, "styles.css"));
                    }
                }
            });
        },
    },
];

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
    metafile: true,
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
        moduleAliasPlugin,
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
