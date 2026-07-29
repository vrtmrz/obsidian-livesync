const repositoryRoot = await Deno.realPath(new URL("../../", import.meta.url));
const composeArgs = ["compose", "-f", "test/browser-apps/compose.yml"];

async function runDocker(args: string[]): Promise<Deno.CommandStatus> {
    return await new Deno.Command("docker", {
        args,
        cwd: repositoryRoot,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    }).spawn().status;
}

let testStatus: Deno.CommandStatus | undefined;
try {
    testStatus = await runDocker([...composeArgs, "run", "--build", "--rm", "browser-apps-interop"]);
} finally {
    const cleanupStatus = await runDocker([...composeArgs, "down", "-v", "--remove-orphans"]);
    if (!cleanupStatus.success) {
        console.error(`[Browser applications E2E] Compose cleanup failed with exit code ${cleanupStatus.code}.`);
        if (testStatus?.success) {
            Deno.exit(cleanupStatus.code);
        }
    }
}

if (!testStatus?.success) {
    const code = testStatus?.code ?? 1;
    console.error(`[Browser applications E2E] Compose interoperability test failed with exit code ${code}.`);
    Deno.exit(code);
}

console.log("\n[Browser applications E2E] Compose interoperability test passed.");
