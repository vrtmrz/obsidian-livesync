import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { REPOSITORY_ROOT } from "./helpers/paths.ts";
import test from "node:test";

type FileCoverage = { f: Record<string, number> };
const reportPath =
    process.env.LIVESYNC_CLI_COVERAGE_REPORT ?? join(REPOSITORY_ROOT, "coverage", "cli-e2e", "coverage-final.json");
const sourceRoot = (join(REPOSITORY_ROOT, "src") + sep).replaceAll("\\", "/");
const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, FileCoverage>;
function coverageFor(suffix: string): FileCoverage {
    const found = Object.entries(report).find(([path]) => path.replaceAll("\\", "/").endsWith(suffix));
    assert.ok(found, `Missing coverage for ${suffix}`);
    return found[1];
}

test("CLI E2E coverage retains executed application functions after source-map remapping", () => {
    assert.ok(
        Object.keys(report).every((path) => path.replaceAll("\\", "/").startsWith(sourceRoot)),
        "The report must contain only source files from this repository"
    );
    const counts = Object.values(coverageFor("/src/apps/cli/main.ts").f);
    assert.ok(counts.length > 0, "The report must retain application function ranges, rather than default line counts");
    assert.ok(
        counts.some((count) => count > 0),
        "The CLI application must have executed"
    );
    assert.ok(
        Object.keys(report).every((path) => !path.replaceAll("\\", "/").includes("/node_modules/")),
        "The application report must exclude bundled dependencies"
    );
});

test(
    "local CLI coverage retains unexecuted P2P functions",
    {
        skip: (process.env.LIVESYNC_CLI_COVERAGE_TASK ?? "test:local") !== "test:local",
    },
    () => {
        const counts = Object.values(coverageFor("/src/apps/cli/commands/p2p.ts").f);
        assert.ok(counts.length > 0, "The report must retain P2P function ranges");
        assert.ok(
            counts.some((count) => count === 0),
            "The local suite must not report every P2P function as executed"
        );
    }
);
