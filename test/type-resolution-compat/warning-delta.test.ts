type EslintMessage = {
    ruleId: string | null;
    message: string;
};

type EslintReport = {
    filePath: string;
    messages: EslintMessage[];
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function scan(repositoryRoot: string, config: string): Promise<EslintMessage[]> {
    const result = await new Deno.Command(`${repositoryRoot}/node_modules/.bin/eslint`, {
        args: ["--config", config, "--concurrency", "off", "--format", "json", "src"],
        cwd: repositoryRoot,
        stdout: "piped",
        stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(result.stderr);
    assert(result.success, `synthetic Community Review scan failed:\n${stderr}`);
    const reports = JSON.parse(new TextDecoder().decode(result.stdout)) as EslintReport[];
    return reports.flatMap((report) =>
        report.messages.filter((message) => message.ruleId === "@typescript-eslint/no-redundant-type-constituents")
    );
}

Deno.test("Commonlib mirror reduces synthetic legacy-resolution warnings", async () => {
    const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
    const legacy = await scan(repositoryRoot, "test/type-resolution-compat/eslint.legacy.config.mjs");
    const compatible = await scan(repositoryRoot, "test/type-resolution-compat/eslint.compat.config.mjs");
    const representativeTypes = [
        "FilePath",
        "InjectableServiceHub",
        "ObsidianLiveSyncSettings",
        "UseP2PReplicatorResult",
    ];

    assert(legacy.length > 0, "the legacy configuration did not reproduce the warning family");
    for (const typeName of representativeTypes) {
        assert(
            legacy.some((warning) => warning.message.includes(`'${typeName}' is an 'error' type`)),
            `the legacy configuration did not reproduce the ${typeName} warning`
        );
        assert(
            !compatible.some((warning) => warning.message.includes(`'${typeName}' is an 'error' type`)),
            `the compatibility mirror did not resolve ${typeName}`
        );
    }
    assert(
        compatible.length < legacy.length,
        `the compatibility mirror did not reduce warnings: ${legacy.length} before, ${compatible.length} after`
    );
});
