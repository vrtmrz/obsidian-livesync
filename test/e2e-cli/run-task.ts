import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CLI_DIR } from "./helpers/paths.ts";
import { spawnProcess } from "./helpers/process.ts";

type Task = { test?: string[]; filter?: string; script?: string; tasks?: string[]; command?: string; args?: string[] };
const taskDirectory = import.meta.dirname;

export async function runTask(name: string, extraArgs: string[] = []): Promise<number> {
    if (Number(process.versions.node.split(".")[0]) < 26) throw new Error("CLI E2E tests require Node.js 26 or newer");
    const tasks = JSON.parse(await readFile(new URL("./tasks.json", import.meta.url), "utf8")) as Record<string, Task>;
    const task = tasks[name];
    if (!task) throw new Error(`Unknown CLI task '${name}'. Available tasks: ${Object.keys(tasks).join(", ")}`);
    if (task.tasks) {
        for (const child of task.tasks) {
            const code = await runTask(child, extraArgs);
            if (code !== 0) return code;
        }
        return 0;
    }
    const envFile = join(CLI_DIR, ".test.env");
    const envArgs = existsSync(envFile) ? [`--env-file=${envFile}`] : [];
    let command = process.execPath;
    let args: string[];
    if (task.test) {
        args = [
            ...envArgs,
            "--test",
            "--test-concurrency=1",
            ...(task.filter ? [`--test-name-pattern=${task.filter}`] : []),
            ...extraArgs,
            ...task.test.map((file) => fileURLToPath(new URL(file, import.meta.url))),
        ];
    } else if (task.script) {
        args = [...envArgs, fileURLToPath(new URL(task.script, import.meta.url)), ...extraArgs];
    } else if (task.command) {
        command = task.command;
        args = [...(task.args ?? []), ...extraArgs];
    } else throw new Error(`CLI task '${name}' has no executable entry point`);
    const child = spawnProcess(command, {
        args,
        cwd: taskDirectory,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    return (await child.status).code;
}

if (import.meta.main) {
    try {
        process.exitCode = await runTask(process.argv[2] ?? "test", process.argv.slice(3));
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
