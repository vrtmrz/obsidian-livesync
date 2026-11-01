import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("fetch database continuity is exercised by standard CLI CI", async () => {
    const ciTasks = JSON.parse(await readFile(new URL("./ci-tasks.json", import.meta.url), "utf8")) as string[];
    const tasks = JSON.parse(await readFile(new URL("./tasks.json", import.meta.url), "utf8")) as Record<
        string,
        { test?: string[] }
    >;
    const workflow = await readFile(new URL("../../.github/workflows/cli-node-tests.yml", import.meta.url), "utf8");

    assert(ciTasks.includes("test:helpers"), "the standard CI suite must run the task registration contract");
    assert(tasks["test:helpers"]?.test?.includes("test-ci-task-contract.ts"));
    assert(ciTasks.includes("test:fetch-database-continuity"), "the continuity task must be in the standard CI suite");
    assert.deepEqual(tasks["test:fetch-database-continuity"]?.test, ["test-fetch-database-continuity.ts"]);
    assert.match(workflow, /test\/e2e-cli\/ci-tasks\.json/, "the automatic CI matrix must read the authoritative task list");
});
