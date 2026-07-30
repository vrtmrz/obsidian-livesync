const COMMONLIB_PATHS = {
    "@vrtmrz/livesync-commonlib": ["./dist/type-resolution-compat/@vrtmrz/livesync-commonlib/index"],
    "@vrtmrz/livesync-commonlib/*": ["./dist/type-resolution-compat/@vrtmrz/livesync-commonlib/*"],
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
        paths?: typeof COMMONLIB_PATHS;
        skipLibCheck: boolean;
    }
): Promise<void> {
    await Deno.writeTextFile(
        projectPath,
        JSON.stringify(
            {
                compilerOptions: {
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
                "",
                "type IsAny<T> = 0 extends 1 & T ? true : false;",
                "type ExpectFalse<T extends false> = T;",
                "type ExpectTrue<T extends true> = T;",
                "type FilePathIsTyped = ExpectFalse<IsAny<FilePath>>;",
                "type FilePathIsString = ExpectTrue<FilePath extends string ? true : false>;",
                "type SettingsAreTyped = ExpectFalse<IsAny<ObsidianLiveSyncSettings>>;",
                'type SettingsRetainRemoteType = ExpectTrue<"remoteType" extends keyof ObsidianLiveSyncSettings ? true : false>;',
                "type ServiceHubIsTyped = ExpectFalse<IsAny<InjectableServiceHub>>;",
                'type ServiceHubRetainsSetting = ExpectTrue<"setting" extends keyof InjectableServiceHub ? true : false>;',
                "type P2PResultIsTyped = ExpectFalse<IsAny<UseP2PReplicatorResult>>;",
                'type P2PResultRetainsReplicator = ExpectTrue<"replicator" extends keyof UseP2PReplicatorResult ? true : false>;',
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
                "];",
                "",
            ].join("\n")
        );
        const projects = [
            { name: "published package", paths: undefined },
            { name: "compatibility mirror", paths: COMMONLIB_PATHS },
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

Deno.test("legacy Commonlib mirror exposes its unresolved Octagonal Wheels boundary", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const temporaryDirectory = await makeTemporaryDirectory(repositoryRoot);
    const fixturePath = `${temporaryDirectory}/consumer.ts`;
    const projectPath = `${temporaryDirectory}/tsconfig.json`;
    try {
        await Deno.writeTextFile(
            fixturePath,
            [
                'import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";',
                "",
                "type ExpectTrue<T extends true> = T;",
                "export type FilePathIsString = ExpectTrue<FilePath extends string ? true : false>;",
                "",
            ].join("\n")
        );
        await writeProject(projectPath, repositoryRoot, fixturePath, {
            moduleResolution: "Node10",
            paths: COMMONLIB_PATHS,
            skipLibCheck: false,
        });

        const result = await runTypeScript(projectPath, repositoryRoot);
        const output = commandOutput(result);
        assert(!result.success, "legacy resolution unexpectedly preserved every transitive package type");
        assert(
            output.includes("Cannot find module 'octagonal-wheels/common/types'"),
            `the expected transitive Octagonal Wheels boundary was not reported:\n${output}`
        );
    } finally {
        await Deno.remove(temporaryDirectory, { recursive: true });
    }
});
