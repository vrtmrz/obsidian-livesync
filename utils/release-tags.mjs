import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
    writeSync(process.stderr.fd, `${message}\n`);
    process.exit(1);
}

function assertVersion(version) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`Invalid release version: ${version}`);
    }
}

function git(args, allowMissing = false) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    if (allowMissing && result.status === 1 && result.stdout === "" && result.stderr === "") {
        return undefined;
    }
    if (result.error) {
        throw new Error(`Could not run git ${args.join(" ")}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(" ")} exited with status ${result.status}.`);
    }
    return result.stdout.trim();
}

function resolveCommit(revision, runGit) {
    return runGit(["rev-parse", "--verify", `${revision}^{commit}`]);
}

function resolveTag(tag, runGit) {
    return runGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], true);
}

export function ensureTags(version, expectedRevision, runGit = git, log = console.log) {
    assertVersion(version);
    const expectedCommit = resolveCommit(expectedRevision, runGit);
    const tags = [version, `${version}-cli`];
    const existing = tags.map((tag) => ({ tag, commit: resolveTag(tag, runGit) }));

    for (const { tag, commit } of existing) {
        if (commit !== undefined && commit !== expectedCommit) {
            throw new Error(`Tag ${tag} points to ${commit}; expected ${expectedCommit}.`);
        }
    }

    for (const { tag, commit } of existing) {
        if (commit === undefined) {
            runGit(["tag", tag, expectedCommit]);
            log(`Created tag ${tag} at ${expectedCommit}.`);
        } else {
            log(`Tag ${tag} already points to the expected commit ${expectedCommit}.`);
        }
    }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
    const [command, version, expectedRevision] = process.argv.slice(2);
    if (command !== "ensure" || !version || !expectedRevision) {
        fail("Usage: node utils/release-tags.mjs ensure <version> <expected-commit>");
    }

    try {
        ensureTags(version, expectedRevision);
    } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
    }
}
