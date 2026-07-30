const COMMONLIB_PATHS = {
    "@vrtmrz/livesync-commonlib": ["./dist/type-resolution-compat/@vrtmrz/livesync-commonlib/index"],
    "@vrtmrz/livesync-commonlib/*": ["./dist/type-resolution-compat/@vrtmrz/livesync-commonlib/*"],
};

const COMPATIBILITY_PATHS = {
    ...COMMONLIB_PATHS,
    "octagonal-wheels": ["./dist/type-resolution-compat/octagonal-wheels/index"],
    "octagonal-wheels/*": ["./dist/type-resolution-compat/octagonal-wheels/*"],
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function runTypeScript(projectPath: string, repositoryRoot: string): Promise<Deno.CommandOutput> {
    const executable = `${repositoryRoot}/node_modules/.bin/tsc${Deno.build.os === "windows" ? ".cmd" : ""}`;
    return await new Deno.Command(executable, {
        args: ["--pretty", "false", "--project", projectPath],
        cwd: repositoryRoot,
        stdout: "piped",
        stderr: "piped",
    }).output();
}

async function writeProject(
    projectPath: string,
    repositoryRoot: string,
    fixturePath: string,
    options: {
        moduleResolution: "Bundler" | "Node10";
        paths?: Record<string, string[]>;
        skipLibCheck: boolean;
    }
): Promise<void> {
    await Deno.writeTextFile(
        projectPath,
        JSON.stringify(
            {
                compilerOptions: {
                    allowImportingTsExtensions: true,
                    baseUrl: repositoryRoot,
                    lib: ["ES2022", "DOM"],
                    module: "ESNext",
                    moduleResolution: options.moduleResolution,
                    noEmit: true,
                    ...(options.paths === undefined ? {} : { paths: options.paths }),
                    skipLibCheck: options.skipLibCheck,
                    strict: true,
                    target: "ES2022",
                    types: [],
                },
                files: [fixturePath],
            },
            null,
            2
        )
    );
}

async function makeTemporaryDirectory(repositoryRoot: string): Promise<string> {
    return await Deno.makeTempDir({
        dir: repositoryRoot,
        prefix: ".livesync-type-resolution-",
    });
}

function commandOutput(result: Deno.CommandOutput): string {
    return new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
}

Deno.test("legacy resolver reaches representative Commonlib entry points", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const temporaryDirectory = await makeTemporaryDirectory(repositoryRoot);
    const fixturePath = `${temporaryDirectory}/consumer.ts`;
    const projectPath = `${temporaryDirectory}/tsconfig.json`;
    try {
        await Deno.writeTextFile(
            fixturePath,
            [
                'import type { FilePath, ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";',
                'import type { UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult";',
                'import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";',
                "",
                "export type Proof = [",
                "    FilePath,",
                "    ObsidianLiveSyncSettings,",
                "    InjectableServiceHub,",
                "    UseP2PReplicatorResult,",
                "];",
                "",
            ].join("\n")
        );
        await writeProject(projectPath, repositoryRoot, fixturePath, {
            moduleResolution: "Node10",
            paths: COMMONLIB_PATHS,
            skipLibCheck: true,
        });

        const result = await runTypeScript(projectPath, repositoryRoot);
        assert(result.success, `legacy Commonlib entry-point resolution failed:\n${commandOutput(result)}`);
    } finally {
        await Deno.remove(temporaryDirectory, { recursive: true });
    }
});

Deno.test("compatibility mirror preserves representative bundler type facts", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const temporaryDirectory = await makeTemporaryDirectory(repositoryRoot);
    const fixturePath = `${temporaryDirectory}/consumer.ts`;
    try {
        await Deno.writeTextFile(
            fixturePath,
            [
                'import type { FilePath, ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";',
                'import type { UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult";',
                'import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";',
                'import type { TaggedType } from "octagonal-wheels/common/types";',
                'import type { ReactiveValue } from "octagonal-wheels/dataobject/reactive";',
                'import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";',
                "",
                "type IsAny<T> = 0 extends 1 & T ? true : false;",
                "type ExpectFalse<T extends false> = T;",
                "type ExpectTrue<T extends true> = T;",
                'type TaggedPath = TaggedType<string, "path">;',
                "type FilePathIsTyped = ExpectFalse<IsAny<FilePath>>;",
                "type FilePathIsString = ExpectTrue<FilePath extends string ? true : false>;",
                "type SettingsAreTyped = ExpectFalse<IsAny<ObsidianLiveSyncSettings>>;",
                'type SettingsRetainRemoteType = ExpectTrue<"remoteType" extends keyof ObsidianLiveSyncSettings ? true : false>;',
                "type ServiceHubIsTyped = ExpectFalse<IsAny<InjectableServiceHub>>;",
                'type ServiceHubRetainsSetting = ExpectTrue<"setting" extends keyof InjectableServiceHub ? true : false>;',
                "type P2PResultIsTyped = ExpectFalse<IsAny<UseP2PReplicatorResult>>;",
                'type P2PResultRetainsReplicator = ExpectTrue<"replicator" extends keyof UseP2PReplicatorResult ? true : false>;',
                "type TaggedPathIsTyped = ExpectFalse<IsAny<TaggedPath>>;",
                "type TaggedPathIsString = ExpectTrue<TaggedPath extends string ? true : false>;",
                "type StringIsNotTaggedPath = ExpectFalse<string extends TaggedPath ? true : false>;",
                "type SimpleStoreIsTyped = ExpectFalse<IsAny<SimpleStore<string>>>;",
                'type SimpleStoreRetainsGet = ExpectTrue<"get" extends keyof SimpleStore<string> ? true : false>;',
                "type ReactiveValueIsTyped = ExpectFalse<IsAny<ReactiveValue<string>>>;",
                'type ReactiveValueRetainsValue = ExpectTrue<"value" extends keyof ReactiveValue<string> ? true : false>;',
                "",
                "export type Proof = [",
                "    FilePathIsTyped,",
                "    FilePathIsString,",
                "    SettingsAreTyped,",
                "    SettingsRetainRemoteType,",
                "    ServiceHubIsTyped,",
                "    ServiceHubRetainsSetting,",
                "    P2PResultIsTyped,",
                "    P2PResultRetainsReplicator,",
                "    TaggedPathIsTyped,",
                "    TaggedPathIsString,",
                "    StringIsNotTaggedPath,",
                "    SimpleStoreIsTyped,",
                "    SimpleStoreRetainsGet,",
                "    ReactiveValueIsTyped,",
                "    ReactiveValueRetainsValue,",
                "];",
                "",
            ].join("\n")
        );
        const projects = [
            { name: "published package", paths: undefined },
            { name: "compatibility mirror", paths: COMPATIBILITY_PATHS },
        ] as const;
        for (const [index, project] of projects.entries()) {
            const projectPath = `${temporaryDirectory}/tsconfig-${index}.json`;
            await writeProject(projectPath, repositoryRoot, fixturePath, {
                moduleResolution: "Bundler",
                paths: project.paths,
                skipLibCheck: true,
            });
            const result = await runTypeScript(projectPath, repositoryRoot);
            assert(result.success, `${project.name} bundler resolution failed:\n${commandOutput(result)}`);
        }
    } finally {
        await Deno.remove(temporaryDirectory, { recursive: true });
    }
});

Deno.test("legacy compatibility mirrors preserve Commonlib and Octagonal Wheels type facts", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const temporaryDirectory = await makeTemporaryDirectory(repositoryRoot);
    const fixturePath = `${temporaryDirectory}/consumer.ts`;
    const projectPath = `${temporaryDirectory}/tsconfig.json`;
    try {
        await Deno.writeTextFile(
            fixturePath,
            [
                'import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";',
                'import type { TaggedType } from "octagonal-wheels/common/types";',
                'import type { ReactiveValue } from "octagonal-wheels/dataobject/reactive";',
                'import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";',
                "",
                "type IsAny<T> = 0 extends 1 & T ? true : false;",
                "type ExpectFalse<T extends false> = T;",
                "type ExpectTrue<T extends true> = T;",
                'type TaggedPath = TaggedType<string, "path">;',
                "type FilePathIsTyped = ExpectFalse<IsAny<FilePath>>;",
                "type FilePathIsString = ExpectTrue<FilePath extends string ? true : false>;",
                "type TaggedPathIsTyped = ExpectFalse<IsAny<TaggedPath>>;",
                "type TaggedPathIsString = ExpectTrue<TaggedPath extends string ? true : false>;",
                "type StringIsNotTaggedPath = ExpectFalse<string extends TaggedPath ? true : false>;",
                "type SimpleStoreIsTyped = ExpectFalse<IsAny<SimpleStore<string>>>;",
                'type SimpleStoreRetainsGet = ExpectTrue<"get" extends keyof SimpleStore<string> ? true : false>;',
                "type ReactiveValueIsTyped = ExpectFalse<IsAny<ReactiveValue<string>>>;",
                'type ReactiveValueRetainsValue = ExpectTrue<"value" extends keyof ReactiveValue<string> ? true : false>;',
                "",
                "export type Proof = [",
                "    FilePathIsTyped,",
                "    FilePathIsString,",
                "    TaggedPathIsTyped,",
                "    TaggedPathIsString,",
                "    StringIsNotTaggedPath,",
                "    SimpleStoreIsTyped,",
                "    SimpleStoreRetainsGet,",
                "    ReactiveValueIsTyped,",
                "    ReactiveValueRetainsValue,",
                "];",
                "",
            ].join("\n")
        );
        await writeProject(projectPath, repositoryRoot, fixturePath, {
            moduleResolution: "Node10",
            paths: COMPATIBILITY_PATHS,
            skipLibCheck: true,
        });

        const result = await runTypeScript(projectPath, repositoryRoot);
        assert(result.success, `legacy compatibility resolution lost package type facts:\n${commandOutput(result)}`);
    } finally {
        await Deno.remove(temporaryDirectory, { recursive: true });
    }
});

Deno.test("legacy compatibility mirror exposes every Octagonal Wheels typed export entry point", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const temporaryDirectory = await makeTemporaryDirectory(repositoryRoot);
    const fixturePath = `${temporaryDirectory}/consumer.ts`;
    const projectPath = `${temporaryDirectory}/tsconfig.json`;
    try {
        const packageJson = JSON.parse(
            await Deno.readTextFile(`${repositoryRoot}/node_modules/octagonal-wheels/package.json`)
        ) as { exports: Record<string, unknown> };
        const typedExportSubpaths = Object.entries(packageJson.exports)
            .filter(
                ([, definition]) =>
                    typeof definition === "object" &&
                    definition !== null &&
                    "types" in definition &&
                    typeof definition.types === "string"
            )
            .map(([subpath]) => subpath);
        const imports = typedExportSubpaths.map((subpath, index) => {
            const specifier = subpath === "." ? "octagonal-wheels" : `octagonal-wheels/${subpath.slice(2)}`;
            return `import type * as PackageExport${index} from ${JSON.stringify(specifier)};`;
        });
        const proofTypes = typedExportSubpaths.map((_, index) => `typeof PackageExport${index}`);
        await Deno.writeTextFile(
            fixturePath,
            [...imports, "", `export type Proof = [${proofTypes.join(", ")}];`, ""].join("\n")
        );
        await writeProject(projectPath, repositoryRoot, fixturePath, {
            moduleResolution: "Node10",
            paths: COMPATIBILITY_PATHS,
            skipLibCheck: true,
        });

        const result = await runTypeScript(projectPath, repositoryRoot);
        assert(result.success, `legacy resolution failed for an Octagonal Wheels export:\n${commandOutput(result)}`);
    } finally {
        await Deno.remove(temporaryDirectory, { recursive: true });
    }
});
