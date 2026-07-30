function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function decode(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

async function runGenerator(
    repositoryRoot: string,
    arguments_: string[]
): Promise<{ success: boolean; stdout: string; stderr: string }> {
    const result = await new Deno.Command("node", {
        args: ["scripts/generate-type-resolution-compat.mjs", ...arguments_],
        cwd: repositoryRoot,
        stdout: "piped",
        stderr: "piped",
    }).output();
    return {
        success: result.success,
        stdout: decode(result.stdout),
        stderr: decode(result.stderr),
    };
}

async function listFiles(root: string, relativeDirectory = ""): Promise<string[]> {
    const directory = relativeDirectory === "" ? root : `${root}/${relativeDirectory}`;
    const entries = [...(await Array.fromAsync(Deno.readDir(directory)))].sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    const files: string[] = [];
    for (const entry of entries) {
        const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
        if (entry.isDirectory) {
            files.push(...(await listFiles(root, relativePath)));
        } else if (entry.isFile) {
            files.push(relativePath);
        } else {
            throw new Error(`unexpected generated entry: ${relativePath}`);
        }
    }
    return files;
}

async function directoryDigest(root: string): Promise<string> {
    const encoder = new TextEncoder();
    const files = await listFiles(root);
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    for (const relativePath of files) {
        const name = encoder.encode(`${relativePath}\0`);
        const contents = await Deno.readFile(`${root}/${relativePath}`);
        chunks.push(name, contents);
        totalLength += name.length + contents.length;
    }
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", combined));
    return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.lstat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

async function writeSyntheticPackage(
    packageRoot: string,
    exports: Record<string, unknown>,
    declarations: Record<string, string>,
    overrides: Record<string, unknown> = {}
): Promise<void> {
    await Deno.mkdir(packageRoot, { recursive: true });
    await Deno.writeTextFile(
        `${packageRoot}/package.json`,
        JSON.stringify(
            {
                name: "@vrtmrz/livesync-commonlib",
                version: "0.1.0",
                type: "module",
                exports,
                ...overrides,
            },
            null,
            2
        )
    );
    for (const [relativePath, source] of Object.entries(declarations)) {
        const components = relativePath.split("/");
        components.pop();
        if (components.length > 0) {
            await Deno.mkdir(`${packageRoot}/${components.join("/")}`, { recursive: true });
        }
        await Deno.writeTextFile(`${packageRoot}/${relativePath}`, source);
    }
}

function validSyntheticExports(): Record<string, unknown> {
    return {
        ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            default: "./dist/index.js",
        },
        "./compat/common/types": {
            types: "./dist/common/types.d.ts",
            import: "./dist/common/types.js",
            default: "./dist/common/types.js",
        },
        "./package.json": "./package.json",
    };
}

Deno.test("root postbuild generates the type-resolution compatibility mirror", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const packageJson = JSON.parse(await Deno.readTextFile(`${repositoryRoot}/package.json`)) as {
        scripts?: Record<string, string>;
    };
    assert(
        packageJson.scripts?.postbuild === "npm run generate:type-resolution-compat",
        "root postbuild does not invoke the compatibility generator"
    );
});

Deno.test("generator covers the installed package export maps deterministically", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const temporaryDirectory = await Deno.makeTempDir({ prefix: "livesync-type-generator-" });
    const outputRoot = `${temporaryDirectory}/output`;
    try {
        const installedPackages = await Promise.all(
            ["@vrtmrz/livesync-commonlib", "octagonal-wheels"].map(async (packageName) => {
                const packageJson = JSON.parse(
                    await Deno.readTextFile(`${repositoryRoot}/node_modules/${packageName}/package.json`)
                ) as { exports: Record<string, unknown> };
                const typedExportCount = Object.values(packageJson.exports).filter(
                    (definition) =>
                        typeof definition === "object" &&
                        definition !== null &&
                        "types" in definition &&
                        typeof definition.types === "string"
                ).length;
                return { packageJson, packageName, typedExportCount };
            })
        );

        const first = await runGenerator(repositoryRoot, ["--output", outputRoot]);
        assert(first.success, `first generation failed:\n${first.stderr}`);
        const firstSummary = JSON.parse(first.stdout) as {
            packages: {
                declarationCount: number;
                exportCount: number;
                metadataExportCount: number;
                packageName: string;
                typedExportCount: number;
            }[];
        };
        assert(firstSummary.packages.length === installedPackages.length, "not every package was generated");
        const expectedDeclarationCounts = new Map([
            ["@vrtmrz/livesync-commonlib", 244],
            ["octagonal-wheels", 109],
        ]);
        for (const installedPackage of installedPackages) {
            const summary = firstSummary.packages.find(
                (candidate) => candidate.packageName === installedPackage.packageName
            );
            assert(summary !== undefined, `${installedPackage.packageName} is missing from the generation summary`);
            assert(
                summary.exportCount === Object.keys(installedPackage.packageJson.exports).length,
                `${installedPackage.packageName} export coverage is incomplete`
            );
            assert(
                summary.typedExportCount === installedPackage.typedExportCount,
                `${installedPackage.packageName} typed export coverage is incomplete`
            );
            assert(
                summary.metadataExportCount === 1,
                `${installedPackage.packageName} metadata export was not accounted for`
            );
            assert(
                summary.declarationCount === expectedDeclarationCounts.get(installedPackage.packageName),
                `${installedPackage.packageName} declaration count changed unexpectedly`
            );
        }

        const firstDigest = await directoryDigest(outputRoot);
        const second = await runGenerator(repositoryRoot, ["--output", outputRoot]);
        assert(second.success, `second generation failed:\n${second.stderr}`);
        assert((await directoryDigest(outputRoot)) === firstDigest, "two generations produced different content");

        const generatedFiles = await listFiles(outputRoot);
        const publicWrappers = generatedFiles.filter(
            (filePath) => filePath.endsWith(".d.ts") && !filePath.includes("/__package__/")
        );
        const expectedWrapperCount = installedPackages.reduce(
            (total, installedPackage) => total + installedPackage.typedExportCount,
            0
        );
        assert(publicWrappers.length === expectedWrapperCount, "generated wrapper count does not match typed exports");
        for (const filePath of generatedFiles.filter((candidate) => candidate.endsWith(".d.ts"))) {
            const source = await Deno.readTextFile(`${outputRoot}/${filePath}`);
            assert(
                !/@ts-(?:expect-error|ignore|nocheck)|eslint-(?:disable|enable)/u.test(source),
                `generated declaration contains a suppression directive: ${filePath}`
            );
        }
        assert(
            (await Deno.readTextFile(`${outputRoot}/@vrtmrz/livesync-commonlib/compat/common/types.d.ts`)) ===
                'export * from "../../__package__/dist/common/types.js";\n',
            "representative wrapper does not re-export the copied declaration"
        );
        const octagonalWheelsWrappers = new Map([
            ["octagonal-wheels/common/types.d.ts", 'export * from "../__package__/dist/common/types.js";\n'],
            [
                "octagonal-wheels/databases/SimpleStoreBase.d.ts",
                'export * from "../__package__/dist/databases/SimpleStoreBase.js";\n',
            ],
            [
                "octagonal-wheels/dataobject/reactive.d.ts",
                'export * from "../__package__/dist/dataobject/reactive.js";\n',
            ],
        ]);
        for (const [relativePath, expectedSource] of octagonalWheelsWrappers) {
            assert(
                (await Deno.readTextFile(`${outputRoot}/${relativePath}`)) === expectedSource,
                `Octagonal Wheels wrapper does not re-export its copied declaration: ${relativePath}`
            );
        }

        const ignored = await new Deno.Command("git", {
            args: ["check-ignore", "--quiet", "dist/type-resolution-compat"],
            cwd: repositoryRoot,
        }).output();
        assert(ignored.success, "the generated repository output is not ignored by Git");
    } finally {
        await Deno.remove(temporaryDirectory, { recursive: true });
    }
});

Deno.test("generator rejects invalid package boundaries and preserves the previous output", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const temporaryDirectory = await Deno.makeTempDir({ prefix: "livesync-type-generator-invalid-" });
    const packageRoot = `${temporaryDirectory}/package`;
    const outputRoot = `${temporaryDirectory}/output`;
    const commonArguments = ["--package-root", packageRoot, "--output", outputRoot, "--expected-version", "0.1.0"];
    try {
        await writeSyntheticPackage(packageRoot, validSyntheticExports(), {
            "dist/common/types.d.ts": "export type FilePath = string;\n",
            "dist/index.d.ts": 'export type { FilePath } from "./common/types.js";\n',
        });
        const initial = await runGenerator(repositoryRoot, commonArguments);
        assert(initial.success, `valid synthetic generation failed:\n${initial.stderr}`);
        const initialDigest = await directoryDigest(outputRoot);

        const nestedOutput = `${packageRoot}/generated`;
        const nestedOutputResult = await runGenerator(repositoryRoot, [...commonArguments, "--output", nestedOutput]);
        assert(!nestedOutputResult.success, "an output inside the input package was accepted");
        assert(nestedOutputResult.stderr.includes("unsafe output"), "unsafe nested output failure was not explained");
        assert(!(await pathExists(nestedOutput)), "unsafe nested output was created");

        if (Deno.build.os !== "windows") {
            const linkedPackageRoot = `${temporaryDirectory}/linked-package`;
            await Deno.symlink(packageRoot, linkedPackageRoot);
            const linkedOutput = `${linkedPackageRoot}/generated`;
            const linkedOutputResult = await runGenerator(repositoryRoot, [
                ...commonArguments,
                "--output",
                linkedOutput,
            ]);
            assert(!linkedOutputResult.success, "a symlinked output inside the input package was accepted");
            assert(
                linkedOutputResult.stderr.includes("unsafe output"),
                "unsafe symlinked-output failure was not explained"
            );
            assert(!(await pathExists(linkedOutput)), "unsafe symlinked output was created");
        }
        assert((await directoryDigest(outputRoot)) === initialDigest, "unsafe output validation replaced prior output");

        await writeSyntheticPackage(
            packageRoot,
            {
                ".": {
                    types: "./dist/missing.d.ts",
                    import: "./dist/index.js",
                    default: "./dist/index.js",
                },
                "./package.json": "./package.json",
            },
            {}
        );
        const missingTarget = await runGenerator(repositoryRoot, commonArguments);
        assert(!missingTarget.success, "a missing types target was accepted");
        assert(missingTarget.stderr.includes("does not exist"), "missing-target failure was not explained");
        assert((await directoryDigest(outputRoot)) === initialDigest, "failed generation replaced the previous output");

        await writeSyntheticPackage(
            packageRoot,
            {
                ".": {
                    types: "./dist/index.d.ts",
                    import: "./dist/index.js",
                    default: "./dist/index.js",
                },
                "./compat/../escape": {
                    types: "./dist/index.d.ts",
                    import: "./dist/index.js",
                    default: "./dist/index.js",
                },
                "./package.json": "./package.json",
            },
            { "dist/index.d.ts": "export interface Safe {}\n" }
        );
        const traversal = await runGenerator(repositoryRoot, commonArguments);
        assert(!traversal.success, "an export path traversal was accepted");
        assert(traversal.stderr.includes("path traversal"), "path-traversal failure was not explained");

        await writeSyntheticPackage(
            packageRoot,
            {
                ".": {
                    types: "./dist/index.d.ts",
                    import: "./dist/index.js",
                    default: "./dist/index.js",
                },
                "./index": {
                    types: "./dist/other.d.ts",
                    import: "./dist/other.js",
                    default: "./dist/other.js",
                },
                "./package.json": "./package.json",
            },
            {
                "dist/index.d.ts": "export interface First {}\n",
                "dist/other.d.ts": "export interface Second {}\n",
            }
        );
        const duplicate = await runGenerator(repositoryRoot, commonArguments);
        assert(!duplicate.success, "duplicate wrapper destinations were accepted");
        assert(duplicate.stderr.includes("same wrapper"), "duplicate-destination failure was not explained");

        await writeSyntheticPackage(packageRoot, validSyntheticExports(), {
            "dist/common/types.d.ts": "// @ts-ignore\nexport type FilePath = string;\n",
            "dist/index.d.ts": 'export type { FilePath } from "./common/types.js";\n',
        });
        const suppression = await runGenerator(repositoryRoot, commonArguments);
        assert(!suppression.success, "a declaration suppression directive was copied");
        assert(suppression.stderr.includes("suppression directive"), "suppression failure was not explained");

        const unsupportedDefaultExports = [
            "export default interface UnsupportedDefault {}\n",
            'export * as default from "./common/types.js";\n',
            'declare const value: string;\nexport { value as "default" };\n',
        ];
        for (const defaultExportSource of unsupportedDefaultExports) {
            await writeSyntheticPackage(packageRoot, validSyntheticExports(), {
                "dist/common/types.d.ts": "export type FilePath = string;\n",
                "dist/index.d.ts": defaultExportSource,
            });
            const defaultExport = await runGenerator(repositoryRoot, commonArguments);
            assert(!defaultExport.success, "a default export unsupported by the wrapper was accepted");
            assert(
                defaultExport.stderr.includes("unsupported default export"),
                "default-export failure was not explained"
            );
            assert(
                (await directoryDigest(outputRoot)) === initialDigest,
                "default-export failure replaced prior output"
            );
        }

        await writeSyntheticPackage(packageRoot, validSyntheticExports(), {
            "dist/common/types.d.ts": "export type FilePath = string;\n",
            "dist/index.d.ts":
                "/** This package does not `export default`; the phrase is documentation only. */\n" +
                'export type { FilePath } from "./common/types.js";\n',
        });
        const documentedDefaultExport = await runGenerator(repositoryRoot, commonArguments);
        assert(
            documentedDefaultExport.success,
            `default-export text in a comment was rejected:\n${documentedDefaultExport.stderr}`
        );

        await writeSyntheticPackage(
            packageRoot,
            validSyntheticExports(),
            {
                "dist/common/types.d.ts": "export type FilePath = string;\n",
                "dist/index.d.ts": 'export type { FilePath } from "./common/types.js";\n',
            },
            { name: "@vrtmrz/not-livesync-commonlib" }
        );
        const wrongName = await runGenerator(repositoryRoot, commonArguments);
        assert(!wrongName.success, "an unexpected package name was accepted");
        assert(wrongName.stderr.includes("Expected package name"), "package-name failure was not explained");

        await writeSyntheticPackage(
            packageRoot,
            validSyntheticExports(),
            {
                "dist/common/types.d.ts": "export type FilePath = string;\n",
                "dist/index.d.ts": 'export type { FilePath } from "./common/types.js";\n',
            },
            { version: "0.1.1" }
        );
        const wrongVersion = await runGenerator(repositoryRoot, commonArguments);
        assert(!wrongVersion.success, "an unexpected package version was accepted");
        assert(
            wrongVersion.stderr.includes("Expected @vrtmrz/livesync-commonlib@0.1.0"),
            "version failure was not explained"
        );
    } finally {
        await Deno.remove(temporaryDirectory, { recursive: true });
    }
});
