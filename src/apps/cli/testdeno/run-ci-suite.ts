const TASKS = [
    "test:setup-put-cat",
    "test:mirror",
    "test:daemon",
    "test:push-pull",
    "test:decoupled-vault",
    "test:sync-two-local",
    "test:sync-locked-remote",
    "test:remote-commands",
    "test:e2e-matrix:couchdb-enc0",
    "test:e2e-matrix:couchdb-enc1",
    "test:e2e-matrix:minio-enc0",
    "test:e2e-matrix:minio-enc1",
] as const;

for (const [index, task] of TASKS.entries()) {
    console.log(`\n[CLI E2E ${index + 1}/${TASKS.length}] ${task}`);
    const child = new Deno.Command(Deno.execPath(), {
        args: ["task", task],
        cwd: import.meta.dirname,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    }).spawn();
    const status = await child.status;
    if (!status.success) {
        console.error(`[CLI E2E] ${task} failed with exit code ${status.code}.`);
        Deno.exit(status.code);
    }
}

console.log(`\n[CLI E2E] CI suite passed (${TASKS.length} tasks).`);
