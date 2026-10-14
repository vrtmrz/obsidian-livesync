import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
type Step = { id?: string; run?: string; uses?: string; with?: Record<string, unknown> };
type Workflow = {
    on: Record<string, { paths?: string[]; [key: string]: unknown }>;
    jobs: Record<
        string,
        { steps?: Step[]; needs?: string | string[]; uses?: string; if?: string; permissions?: Record<string, string> }
    >;
};
function workflow(name: string): Workflow {
    return parse(readFileSync(new URL(`.github/workflows/${name}`, root), "utf8")) as Workflow;
}
function matches(paths: string[], file: string): boolean {
    let included = false;
    for (const pattern of paths) {
        const negative = pattern.startsWith("!");
        if (minimatch(file, negative ? pattern.slice(1) : pattern)) included = !negative;
    }
    return included;
}
function localTasks(): string[] {
    const runner = readFileSync(new URL("src/apps/cli/testdeno/run-ci-suite.ts", root), "utf8");
    expect(runner).toContain('import TASKS from "./ci-tasks.json" with { type: "json" }');
    return JSON.parse(readFileSync(new URL("src/apps/cli/testdeno/ci-tasks.json", root), "utf8")) as string[];
}
function selectedTasks(task: string): string[] {
    const select = workflow("cli-deno-tests.yml").jobs.prepare.steps?.find((step) => step.id === "select");
    expect(select?.run).toBeDefined();
    const directory = mkdtempSync(join(tmpdir(), "livesync-ci-matrix-"));
    const output = join(directory, "output");
    try {
        const script = select!.run!.replace(/\$\{\{[^}]+\}\}/g, task);
        const result = spawnSync("bash", ["-c", script], {
            cwd: root,
            env: { ...process.env, SELECTED_TASK: task, GITHUB_OUTPUT: output },
            encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        const line = readFileSync(output, "utf8")
            .split("\n")
            .find((line) => line.startsWith("task_matrix="));
        return JSON.parse(line!.slice("task_matrix=".length)) as string[];
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

describe("CLI CI selection", () => {
    it("runs every task in the local standard suite automatically", () => {
        expect(selectedTasks("test:ci")).toEqual(localTasks());
        expect(selectedTasks("test:ci")).toEqual(
            expect.arrayContaining(["test:settings-writeback", "test:remote-administration-exit-codes"])
        );
        const tasks = JSON.parse(readFileSync(new URL("src/apps/cli/testdeno/deno.json", root), "utf8")).tasks;
        expect(localTasks().filter((task) => !(task in tasks))).toEqual([]);
        expect(new Set(localTasks()).size).toBe(localTasks().length);
    });
    it("keeps the selected manual subsets", () => {
        expect(selectedTasks("test:local")).toEqual(["test:setup-put-cat", "test:mirror", "test:daemon"]);
        expect(selectedTasks("test:e2e-matrix")).toEqual(
            localTasks().filter((task) => task.startsWith("test:e2e-matrix:"))
        );
    });
    it.each([
        ["cli-deno-tests.yml", "push"],
        ["cli-deno-tests.yml", "pull_request"],
        ["cli-p2p-tests.yml", "push"],
        ["cli-p2p-tests.yml", "pull_request"],
        ["cli-docker.yml", "push"],
        ["cli-docker-validation.yml", "pull_request"],
    ])("validates shared CLI runtime inputs in %s on %s", (name, event) => {
        const paths = workflow(name).on[event].paths ?? [];
        const inputs = [
            "src/apps/cli/main.ts",
            "src/LiveSyncBaseCore.ts",
            "src/serviceFeatures/replicationScheduling.ts",
            "src/common/replicatorProviders.ts",
            "src/common/messages/en.ts",
            "src/modules/AbstractModule.ts",
            "src/modules/main/ModuleLiveSyncMain.ts",
            "src/modules/coreFeatures/ModuleResolveMismatchedTweaks.ts",
            "src/serviceModules/FileHandler.ts",
            "src/integrations/cloudflare/turnCredentials.ts",
            "manifest.json",
            "package.json",
            "package-lock.json",
            "tsconfig.json",
        ];
        expect(inputs.filter((file) => !matches(paths, file))).toEqual([]);
        expect(matches(paths, "src/modules/features/ModuleObsidianSettingTab.ts")).toBe(false);
        expect(matches(paths, "docs/settings.md")).toBe(false);
        expect(matches(paths, "src/apps/cli/testdeno/CONTRIBUTING_TESTS.md")).toBe(false);
    });
    it("runs Compose alone for a change to its fixture", () => {
        const file = "test/bench-network/compose.yml";
        expect(matches(workflow("cli-p2p-tests.yml").on.pull_request.paths ?? [], file)).toBe(true);
        expect(matches(workflow("cli-deno-tests.yml").on.pull_request.paths ?? [], file)).toBe(false);
        expect(matches(workflow("cli-docker-validation.yml").on.pull_request.paths ?? [], file)).toBe(false);
    });
    it("passes a single CLI build to every standard test job", () => {
        const { prepare, test } = workflow("cli-deno-tests.yml").jobs;
        expect(test.needs).toBe("prepare");
        expect(prepare.steps?.filter((step) => step.run === "npm run build")).toHaveLength(1);
        expect(test.steps?.some((step) => step.run?.includes("npm run build"))).toBe(false);
        const upload = prepare.steps?.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
        const download = test.steps?.find((step) => step.uses?.startsWith("actions/download-artifact@"));
        expect(upload?.with?.["if-no-files-found"]).toBe("error");
        expect(download?.with?.name).toBe(upload?.with?.name);
        expect(download?.with?.path).toBe(upload?.with?.path);
    });
    it("keeps registry credentials out of Docker validation and gates publication on it", () => {
        const validation = workflow("cli-docker-validation.yml");
        const publication = workflow("cli-docker.yml");
        expect(validation.on.push).toBeUndefined();
        const validationJob = validation.jobs.validate;
        expect(validationJob.steps?.some((step) => step.uses?.startsWith("docker/login-action@"))).toBe(false);
        const build = validationJob.steps?.find((step) => step.uses?.startsWith("docker/build-push-action@"));
        expect(build?.with?.load).toBe(true);
        expect(build?.with?.push).toBeUndefined();
        expect(validationJob.steps?.find((step) => step.id === "e2e")?.run).toBe(
            "npm --ignore-scripts run test:e2e:docker:all"
        );
        expect(publication.jobs.validate.uses).toBe("./.github/workflows/cli-docker-validation.yml");
        expect(publication.jobs.validate.permissions).toEqual({ contents: "read" });
        expect(publication.jobs["build-and-push"].needs).toBe("validate");
        expect(publication.jobs["build-and-push"].if).toBe(
            "${{ needs.validate.outputs.e2e_passed == 'true' || (github.event_name == 'workflow_dispatch' && inputs.force) }}"
        );
        const publishBuild = publication.jobs["build-and-push"].steps?.find((step) =>
            step.uses?.startsWith("docker/build-push-action@")
        );
        expect(publishBuild?.with?.["cache-from"]).toBe(build?.with?.["cache-from"]);
        expect(publishBuild?.with?.["cache-to"]).toBe(build?.with?.["cache-to"]);
    });
});
