import TASKS from "./ci-tasks.json" with { type: "json" };

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
