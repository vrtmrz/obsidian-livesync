import { readFileSync } from "node:fs";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Trigger = "push" | "pull_request";
type Concurrency = {
    group?: string;
    "cancel-in-progress"?: boolean | string;
};
type Workflow = {
    on?: Partial<Record<Trigger, { paths?: string[]; types?: string[] }>>;
    concurrency?: Concurrency;
    jobs?: Record<string, { if?: string; concurrency?: Concurrency }>;
};

function readWorkflow(filename: string): Workflow {
    const source = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), "utf8");
    return parse(source) as Workflow;
}

function matchesAnyPath(patterns: string[], filename: string): boolean {
    return patterns.some((pattern) => minimatch(filename, pattern));
}

const pagesWorkflow = readWorkflow("deploy-pages.yml");
const unitWorkflow = readWorkflow("unit-ci.yml");

describe("Pages pull request lifecycle", () => {
    it("defers draft validation and starts checks when the pull request is ready", () => {
        expect(pagesWorkflow.jobs?.build?.if).toBe(
            "${{ github.event_name != 'pull_request' || !github.event.pull_request.draft }}"
        );
        expect(pagesWorkflow.on?.pull_request?.types).toEqual(
            expect.arrayContaining(["opened", "synchronize", "reopened", "ready_for_review"])
        );
        expect(pagesWorkflow.jobs?.deploy?.if).toBe("github.event_name != 'pull_request'");
    });
});

describe("CI workflow path filters", () => {
    it.each(["push", "pull_request"] as const)("runs Pages checks for the manifest on %s", (trigger) => {
        const patterns = pagesWorkflow.on?.[trigger]?.paths ?? [];
        expect(matchesAnyPath(patterns, "manifest.json")).toBe(true);
    });

    it.each(["push", "pull_request"] as const)("runs unit CI for required inputs on %s", (trigger) => {
        const patterns = unitWorkflow.on?.[trigger]?.paths ?? [];
        const requiredInputs = [
            "manifest.json",
            "updates.md",
            "_tools/bakei18n.ts",
            "terser.config.mjs",
            "utils/check-compatibility.js",
            "utils/livesync-commonlib-version.test.ts",
            "utils/livesync-commonlib-version.ts",
            "utils/ci-pages.unit.spec.ts",
            "utils/cli-ci.unit.spec.ts",
            ".github/workflows/cli-docker.yml",
            ".github/workflows/cli-deno-tests.yml",
            ".github/workflows/cli-p2p-tests.yml",
            ".github/workflows/cli-docker-validation.yml",
        ];

        expect(requiredInputs.filter((filename) => !matchesAnyPath(patterns, filename))).toEqual([]);
        expect(matchesAnyPath(patterns, "utils/unrelated.unit.spec.ts")).toBe(false);
    });
});

describe("Pages workflow concurrency", () => {
    it("isolates pull requests from publishing refs and cancels superseded pull request runs", () => {
        expect(pagesWorkflow.concurrency).toEqual({
            group: "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
            "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
        });
    });

    it("serialises deployments without cancelling an active deployment", () => {
        expect(pagesWorkflow.jobs?.deploy?.concurrency).toEqual({
            group: "pages",
            "cancel-in-progress": false,
        });
    });
});
