import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
type Step = { id?: string; run?: string; uses?: string; if?: string; with?: Record<string, unknown> };
type Workflow = {
    on: Record<string, { paths?: string[]; [key: string]: unknown }>;
    jobs: Record<
        string,
        {
            steps?: Step[];
            needs?: string | string[];
            uses?: string;
            if?: string;
            permissions?: Record<string, string>;
            "runs-on"?: string;
            strategy?: { matrix?: { include?: Array<{ arch: string; runner: string }> } };
        }
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
        const publishJob = publication.jobs["publish-images"];
        expect(publishJob.needs).toEqual(["metadata", "validate"]);
        expect(publishJob.if).toBe(
            "${{ needs.validate.outputs.e2e_passed == 'true' || (github.event_name == 'workflow_dispatch' && inputs.force) }}"
        );
        expect(publishJob.strategy?.matrix?.include).toEqual(validationJob.strategy?.matrix?.include);
        expect(publishJob["runs-on"]).toBe("${{ matrix.runner }}");
        const publishBuild = publishJob.steps?.find((step) => step.uses?.startsWith("docker/build-push-action@"));
        expect(publishBuild?.with?.file).toBe("src/apps/cli/Dockerfile.publish");
        expect(publishBuild?.with?.["build-contexts"]).toBe(
            "validated-image=oci-layout://${{ runner.temp }}/cli-image@${{ steps.image-context.outputs.digest }}"
        );
        const imageUpload = validationJob.steps?.find(
            (step) => step.with?.name === "cli-docker-image-${{ matrix.arch }}"
        );
        const imageDownload = publishJob.steps?.find(
            (step) => step.with?.name === "cli-docker-image-${{ matrix.arch }}"
        );
        expect(imageUpload?.with?.path).toBe("${{ runner.temp }}/cli-image.tar");
        expect(build?.with?.outputs).toBe("type=oci,dest=${{ runner.temp }}/cli-image.tar");
        expect(imageDownload?.with?.name).toBe(imageUpload?.with?.name);
        const publishingInstructions = readFileSync(new URL("src/apps/cli/Dockerfile.publish", root), "utf8")
            .split("\n")
            .filter((line) => line && !line.startsWith("#"));
        expect(publishingInstructions).toEqual(["FROM validated-image"]);
        expect(publishBuild?.with?.outputs).toBe(
            "type=image,name=${{ needs.metadata.outputs.image }},push-by-digest=true,name-canonical=true,push=${{ needs.metadata.outputs.push }}"
        );
        expect(publishJob.steps?.some((step) => step.uses?.startsWith("docker/setup-qemu-action@"))).toBe(false);
        expect(publishJob.steps?.find((step) => step.uses?.startsWith("docker/login-action@"))?.if).toBe(
            "needs.metadata.outputs.push == 'true'"
        );
        const manifestJob = publication.jobs.manifest;
        expect(manifestJob.needs).toEqual(["metadata", "publish-images"]);
        expect(manifestJob.steps?.find((step) => step.run?.includes("imagetools create"))?.run).toContain(
            'if [[ "$PUSH" == "true" ]]; then'
        );
    });
    it("builds and tests Docker images on both native architectures", () => {
        const job = workflow("cli-docker-validation.yml").jobs.validate;
        expect(job.strategy?.matrix?.include).toEqual([
            { arch: "amd64", runner: "ubuntu-24.04" },
            { arch: "arm64", runner: "ubuntu-24.04-arm" },
        ]);
        expect(job["runs-on"]).toBe("${{ matrix.runner }}");
        expect(job.steps?.some((step) => step.uses?.startsWith("docker/setup-qemu-action@"))).toBe(false);
    });
    it("builds the Docker JavaScript bundle once and passes it to the native image builds", () => {
        const jobs = workflow("cli-docker-validation.yml").jobs;
        expect(jobs.bundle?.steps?.filter((step) => step.run === "npm run build") ?? []).toHaveLength(1);
        expect(jobs.validate.needs).toBe("bundle");
        const upload = jobs.bundle?.steps?.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
        const download = jobs.validate.steps?.find((step) => step.uses?.startsWith("actions/download-artifact@"));
        expect(download?.with?.name).toBe(upload?.with?.name);
        expect(download?.with?.path).toBe("_cli-bundle/");
        const build = jobs.validate.steps?.find((step) => step.uses?.startsWith("docker/build-push-action@"));
        expect(build?.with?.["build-args"]).toBe("CLI_BUNDLE_STAGE=prebuilt");
    });
    it.each([false, true])("assembles both image digests with publication=%s", (push) => {
        const step = workflow("cli-docker.yml").jobs.manifest.steps?.find((step) =>
            step.run?.includes("imagetools create")
        );
        expect(step?.run).toBeDefined();
        const directory = mkdtempSync(join(tmpdir(), "livesync-cli-manifest-"));
        try {
            const digests = join(directory, "cli-digests");
            const bin = join(directory, "bin");
            mkdirSync(digests);
            mkdirSync(bin);
            for (const [arch, char] of [
                ["amd64", "a"],
                ["arm64", "b"],
            ]) {
                writeFileSync(
                    join(digests, `${arch}.json`),
                    JSON.stringify({ arch, digest: `sha256:${char.repeat(64)}` })
                );
            }
            const capture = join(directory, "docker-args");
            writeFileSync(join(bin, "docker"), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$CLI_TEST_CAPTURE"\n', {
                mode: 0o755,
            });
            const image = "ghcr.io/test-owner/livesync-cli";
            const tags = [`${image}:1.0.36-cli`, `${image}:latest`];
            const result = spawnSync("bash", ["-c", step!.run!], {
                cwd: root,
                env: {
                    ...process.env,
                    RUNNER_TEMP: directory,
                    IMAGE: image,
                    IMAGE_TAGS: tags.join(","),
                    PUSH: String(push),
                    PATH: `${bin}:${process.env.PATH}`,
                    CLI_TEST_CAPTURE: capture,
                },
                encoding: "utf8",
            });
            expect(result.status, result.stderr).toBe(0);
            if (push) {
                expect(readFileSync(capture, "utf8").trim().split("\n")).toEqual([
                    "buildx",
                    "imagetools",
                    "create",
                    "--tag",
                    tags[0],
                    "--tag",
                    tags[1],
                    `${image}@sha256:${"a".repeat(64)}`,
                    `${image}@sha256:${"b".repeat(64)}`,
                ]);
            } else {
                expect(existsSync(capture)).toBe(false);
                expect(result.stdout).toContain("publication skipped");
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it.each([
        [
            "1.0.36",
            "refs/tags/1.0.36-cli",
            "push",
            "false",
            true,
            ["1.0.36-cli", "1.0-cli", "latest", "1.0.36-sha-deadbee-cli"],
        ],
        [
            "1.0.36-rc.1",
            "refs/tags/1.0.36-rc.1-cli",
            "push",
            "false",
            true,
            ["1.0.36-rc.1-cli", "1.0.36-rc.1-sha-deadbee-cli"],
        ],
        [
            "1.0.36",
            "refs/tags/1.0.36-patch1-cli",
            "push",
            "false",
            true,
            ["1.0.36-patch1-cli", "1.0.36-patch1-sha-deadbee-cli"],
        ],
        [
            "1.0.36",
            "refs/tags/1.0.36-rc.1-cli",
            "push",
            "false",
            true,
            ["1.0.36-rc.1-cli", "1.0.36-rc.1-sha-deadbee-cli"],
        ],
        [
            "1.0.36",
            "refs/tags/1.0.37-cli",
            "push",
            "false",
            true,
            ["1.0.37-cli", "1.0-cli", "latest", "1.0.37-sha-deadbee-cli"],
        ],
        [
            "1.0.36",
            "refs/tags/1.0.36-patch2-cli",
            "workflow_dispatch",
            "true",
            false,
            ["1.0.36-patch2-cli", "1.0.36-patch2-sha-deadbee-cli"],
        ],
        [
            "1.0.36",
            "refs/tags/1.0.36",
            "workflow_dispatch",
            "true",
            false,
            ["1.0.36-cli", "1.0-cli", "latest", "1.0.36-sha-deadbee-cli"],
        ],
        ["1.0.36", "refs/tags/not-a-version-cli", "workflow_dispatch", "true", false, null],
        ["1.0.36", "refs/tags/1.0.36+build-cli", "push", "false", false, null],
        ["1.0.36", "refs/heads/main", "push", "false", true, ["edge"]],
        ["1.0.36", "refs/heads/test", "workflow_dispatch", "true", false, ["1.0.36-dev-sha-deadbee-cli"]],
    ] as const)("derives publication metadata for manifest %s on %s", (version, ref, event, dryRun, push, tags) => {
        const metadata = workflow("cli-docker.yml").jobs.metadata.steps?.find((step) => step.id === "meta");
        expect(metadata?.run).toBeDefined();
        const directory = mkdtempSync(join(tmpdir(), "livesync-cli-image-metadata-"));
        try {
            const bin = join(directory, "bin");
            const output = join(directory, "output");
            mkdirSync(bin);
            writeFileSync(join(directory, "manifest.json"), JSON.stringify({ version }));
            writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf 'deadbee\\n'\n", { mode: 0o755 });
            const script = metadata!.run!.replace("${{ github.repository_owner }}", "test-owner");
            const result = spawnSync("bash", ["-e", "-c", script], {
                cwd: directory,
                env: {
                    ...process.env,
                    GITHUB_OUTPUT: output,
                    REF: ref,
                    EVENT_NAME: event,
                    DRY_RUN: dryRun,
                    PATH: `${bin}:${process.env.PATH}`,
                },
                encoding: "utf8",
            });
            if (tags === null) {
                expect(result.status).not.toBe(0);
                expect(result.stderr).toContain("Invalid CLI release tag");
                expect(existsSync(output)).toBe(false);
                return;
            }
            expect(result.status, result.stderr).toBe(0);
            const image = "ghcr.io/test-owner/livesync-cli";
            expect(readFileSync(output, "utf8").trim().split("\n")).toEqual([
                `image=${image}`,
                `tags=${tags.map((tag) => `${image}:${tag}`).join(",")}`,
                `push=${push}`,
            ]);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
