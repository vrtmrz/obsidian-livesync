import { spawnProcess } from "./helpers/process.ts";
import { fileURLToPath } from "node:url";
import TASKS from "./ci-tasks.json" with { type: "json" };

for (const [index, task] of TASKS.entries()) {
    console.log(`\n[CLI E2E ${index + 1}/${TASKS.length}] ${task}`);
    const child = spawnProcess(process.execPath, {
        args: [fileURLToPath(new URL("./run-task.ts", import.meta.url)), task],
        cwd: import.meta.dirname,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    const status = await child.status;
    if (!status.success) {
        console.error(`[CLI E2E] ${task} failed with exit code ${status.code}.`);
        process.exit(status.code);
    }
}

console.log(`\n[CLI E2E] CI suite passed (${TASKS.length} tasks).`);
