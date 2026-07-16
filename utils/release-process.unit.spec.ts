import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureTags } from "./release-tags.mjs";

const releaseNotesScript = fileURLToPath(new URL("./release-notes.mjs", import.meta.url));
const versionBumpScript =
    process.env.VERSION_BUMP_SCRIPT || fileURLToPath(new URL("../version-bump.mjs", import.meta.url));
const workspaceUpdateScript = fileURLToPath(new URL("../update-workspaces.mjs", import.meta.url));
const prepareReleaseWorkflow = fileURLToPath(new URL("../.github/workflows/prepare-release.yml", import.meta.url));
const finaliseReleaseWorkflow = fileURLToPath(new URL("../.github/workflows/finalise-release.yml", import.meta.url));
const releaseWorkflow = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function makeTemporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "livesync-release-notes-"));
    temporaryDirectories.push(directory);
    return directory;
}

function writeJson(directory: string, path: string, value: unknown): void {
    const fullPath = join(directory, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

function runNode(script: string, args: string[], cwd: string, env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script, ...args], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...env },
    });
}

function createTagGit(expectedRevision: string, initialTags: Record<string, string> = {}) {
    const tags = new Map(Object.entries(initialTags));
    const git = (args: string[], allowMissing = false): string | undefined => {
        if (args[0] === "rev-parse") {
            const revision = args.at(-1);
            if (revision === `${expectedRevision}^{commit}`) return expectedRevision;
            const tagMatch = revision?.match(/^refs\/tags\/(.+)\^\{commit\}$/);
            if (tagMatch) {
                const commit = tags.get(tagMatch[1]);
                if (commit !== undefined) return commit;
                if (allowMissing) return undefined;
            }
        }
        if (args[0] === "tag" && args.length === 3) {
            tags.set(args[1], args[2]);
            return "";
        }
        throw new Error(`Unexpected git command: ${args.join(" ")}`);
    };
    return { git, tags };
}

function createReleaseFixture(version = "0.25.81"): string {
    const directory = makeTemporaryDirectory();
    writeJson(directory, "package.json", { version });
    writeJson(directory, "manifest.json", { version, minAppVersion: "1.7.2" });
    writeJson(directory, "versions.json", { [version]: "1.7.2" });
    for (const workspace of ["cli", "webpeer", "webapp"]) {
        writeJson(directory, `src/apps/${workspace}/package.json`, { version: `${version}-${workspace}` });
    }
    writeFileSync(
        join(directory, "updates.md"),
        "# 0.25\n\n## Unreleased\n\n### Fixed\n\n- Preserved file content.\n\n## 0.25.80\n\n7th July, 2026\n\n- Previous release.\n",
        "utf8"
    );
    return directory;
}

describe("release notes", () => {
    it("moves Unreleased notes into a dated release and validates the result", () => {
        const directory = createReleaseFixture();

        const prepared = runNode(releaseNotesScript, ["prepare", "0.25.81"], directory, {
            RELEASE_DATE: "14th July, 2026",
        });

        expect(prepared.status, prepared.stderr).toBe(0);
        expect(readFileSync(join(directory, "updates.md"), "utf8")).toBe(
            "# 0.25\n\n## Unreleased\n\n## 0.25.81\n\n14th July, 2026\n\n### Fixed\n\n- Preserved file content.\n\n## 0.25.80\n\n7th July, 2026\n\n- Previous release.\n"
        );

        const validated = runNode(releaseNotesScript, ["validate", "0.25.81"], directory);
        expect(validated.status, validated.stderr).toBe(0);
    });

    it("rejects an empty Unreleased section unless explicitly allowed", () => {
        const directory = createReleaseFixture();
        writeFileSync(
            join(directory, "updates.md"),
            "# 0.25\n\n## Unreleased\n\n## 0.25.80\n\nPrevious release.\n",
            "utf8"
        );

        const rejected = runNode(releaseNotesScript, ["prepare", "0.25.81"], directory);
        expect(rejected.status).toBe(1);
        expect(rejected.stderr).toContain("The '## Unreleased' section is empty.");

        const allowed = runNode(releaseNotesScript, ["prepare", "0.25.81"], directory, {
            ALLOW_EMPTY_UPDATES: "true",
            RELEASE_DATE: "14th July, 2026",
        });
        expect(allowed.status, allowed.stderr).toBe(0);
    });

    it("rejects unfinished release notes", () => {
        const directory = createReleaseFixture();
        writeFileSync(
            join(directory, "updates.md"),
            "# 0.25\n\n## Unreleased\n\n## 0.25.81\n\n14th July, 2026\n\n- TODO: finish these notes.\n",
            "utf8"
        );

        const result = runNode(releaseNotesScript, ["validate", "0.25.81"], directory);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("still contain TODO or WIP markers");
    });
});

describe("release workflow", () => {
    it("regenerates and stages fallback type definitions", () => {
        const workflow = readFileSync(prepareReleaseWorkflow, "utf8");

        expect(workflow).toContain("npm run build:lib:types");
        expect(workflow).toMatch(/git add[^\n]*_types/);
    });

    it("installs Deno before post-processing fallback type definitions", () => {
        const workflow = readFileSync(prepareReleaseWorkflow, "utf8");
        const setupDeno = workflow.indexOf("denoland/setup-deno@v2");
        const buildTypes = workflow.indexOf("npm run build:lib:types");

        expect(setupDeno).toBeGreaterThan(-1);
        expect(setupDeno).toBeLessThan(buildTypes);
    });

    it("keeps the release PR in draft until BRAT validation", () => {
        const workflow = readFileSync(prepareReleaseWorkflow, "utf8");

        expect(workflow).toContain("Merge intentionally on hold");
        expect(workflow).toContain(
            "Publish the GitHub Release as the latest stable release while keeping this pull request in draft"
        );
        expect(workflow).toContain("Validate the published release with BRAT");
        expect(workflow).toContain("Mark this pull request ready and merge it with a merge commit");
    });

    it("explicitly dispatches publishing workflows after creating tags", () => {
        const workflow = readFileSync(finaliseReleaseWorkflow, "utf8");

        expect(workflow).toContain("actions: write");
        expect(workflow).toContain('node utils/release-tags.mjs ensure "${VERSION}" "${EXPECTED_HEAD_SHA}"');
        expect(workflow).toContain('git push --atomic origin "refs/tags/${VERSION}" "refs/tags/${VERSION}-cli"');
        expect(workflow).not.toContain("Tag already exists");
        expect(workflow).toContain("gh workflow run release.yml");
        expect(workflow).toContain("gh workflow run cli-docker.yml");
        expect(workflow).toContain("dry_run=false");
    });

    it("publishes only by explicit dispatch and validates the selected release", () => {
        const workflow = readFileSync(releaseWorkflow, "utf8");

        expect(workflow).not.toMatch(/^\s+push:/m);
        expect(workflow).toContain("ref: ${{ inputs.tag }}");
        expect(workflow).toContain('node utils/release-notes.mjs validate "${TAG}"');
        expect(workflow).toContain('TAG_SHA="$(git rev-parse "refs/tags/${TAG}^{commit}")"');
        expect(workflow).not.toContain("Get Version");
    });
});

describe("release tags", () => {
    it("creates missing tags and accepts matching tags on retry", () => {
        const head = "a".repeat(40);
        const { git, tags } = createTagGit(head);
        const messages: string[] = [];

        ensureTags("0.25.84", head, git, (message) => messages.push(message));
        expect(tags.get("0.25.84")).toBe(head);
        expect(tags.get("0.25.84-cli")).toBe(head);

        ensureTags("0.25.84", head, git, (message) => messages.push(message));
        expect(messages).toContain(`Tag 0.25.84 already points to the expected commit ${head}.`);
        expect(messages).toContain(`Tag 0.25.84-cli already points to the expected commit ${head}.`);
    });

    it("rejects an existing release tag that points to another commit without creating missing tags", () => {
        const previousHead = "b".repeat(40);
        const expectedHead = "a".repeat(40);
        const { git, tags } = createTagGit(expectedHead, { "0.25.84-cli": previousHead });

        expect(() => ensureTags("0.25.84", expectedHead, git)).toThrow(
            `Tag 0.25.84-cli points to ${previousHead}; expected ${expectedHead}.`
        );
        expect(tags.has("0.25.84")).toBe(false);
    });
});

describe("version bump", () => {
    it("records every release even when its minimum app version is already used", () => {
        const directory = makeTemporaryDirectory();
        writeJson(directory, "manifest.json", { version: "0.25.80", minAppVersion: "1.7.2" });
        writeJson(directory, "versions.json", { "0.25.61": "1.7.2" });

        const result = runNode(versionBumpScript, [], directory, { npm_package_version: "0.25.81" });

        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"))).toMatchObject({
            version: "0.25.81",
            minAppVersion: "1.7.2",
        });
        expect(JSON.parse(readFileSync(join(directory, "versions.json"), "utf8"))).toEqual({
            "0.25.61": "1.7.2",
            "0.25.81": "1.7.2",
        });
    });
});

describe("workspace version update", () => {
    it("keeps workspace package and lockfile versions together", () => {
        const directory = makeTemporaryDirectory();
        const workspaces = ["src/apps/cli", "src/apps/webpeer", "src/apps/webapp"];
        writeJson(directory, "package.json", {
            version: "0.25.81",
            workspaces,
            dependencies: { "octagonal-wheels": "^0.1.51" },
            devDependencies: { typescript: "^5.9.3" },
        });
        for (const workspace of ["cli", "webpeer", "webapp"]) {
            writeJson(directory, `src/apps/${workspace}/package.json`, {
                version: `0.25.80-${workspace}`,
                dependencies: { "octagonal-wheels": "^0.1.50" },
                devDependencies: { typescript: "^5.8.0" },
            });
        }
        writeJson(directory, "package-lock.json", {
            name: "obsidian-livesync",
            version: "0.25.80",
            lockfileVersion: 3,
            packages: {
                "": { version: "0.25.80", workspaces },
                "src/apps/cli": {
                    version: "0.25.80-cli",
                    dependencies: { "octagonal-wheels": "^0.1.50" },
                    devDependencies: { typescript: "^5.8.0" },
                },
                "src/apps/webpeer": {
                    version: "0.25.80-webpeer",
                    dependencies: { "octagonal-wheels": "^0.1.50" },
                    devDependencies: { typescript: "^5.8.0" },
                },
                "src/apps/webapp": {
                    version: "0.25.80-webapp",
                    dependencies: { "octagonal-wheels": "^0.1.50" },
                    devDependencies: { typescript: "^5.8.0" },
                },
            },
        });

        const result = runNode(workspaceUpdateScript, [], directory);

        expect(result.status, result.stderr).toBe(0);
        for (const workspace of ["cli", "webpeer", "webapp"]) {
            const packageJson = JSON.parse(readFileSync(join(directory, `src/apps/${workspace}/package.json`), "utf8"));
            expect(packageJson.version).toBe(`0.25.81-${workspace}`);
            expect(packageJson.dependencies["octagonal-wheels"]).toBe("^0.1.51");
            expect(packageJson.devDependencies.typescript).toBe("^5.9.3");
        }
        const packageLock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"));
        expect(packageLock.version).toBe("0.25.81");
        expect(packageLock.packages[""].version).toBe("0.25.81");
        expect(packageLock.packages["src/apps/cli"].version).toBe("0.25.81-cli");
        expect(packageLock.packages["src/apps/webpeer"].version).toBe("0.25.81-webpeer");
        expect(packageLock.packages["src/apps/webapp"].version).toBe("0.25.81-webapp");
        for (const workspace of workspaces) {
            expect(packageLock.packages[workspace].dependencies["octagonal-wheels"]).toBe("^0.1.51");
            expect(packageLock.packages[workspace].devDependencies.typescript).toBe("^5.9.3");
        }
    });
});
