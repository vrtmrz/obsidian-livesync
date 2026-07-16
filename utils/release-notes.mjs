import { readFileSync, writeFileSync, writeSync } from "fs";

const updatesPath = "updates.md";

// Utility used by the release workflows to rotate and validate `updates.md`.
// It intentionally keeps the Markdown format simple: top-level `##` headings
// are treated as release boundaries, and only one `## Unreleased` section is
// allowed.

function fail(message) {
    writeSync(process.stderr.fd, `${message}\n`);
    process.exit(1);
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

function assertVersion(version) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        fail(`Invalid release version: ${version}`);
    }
}

function formatReleaseDate(date = new Date()) {
    const day = date.getUTCDate();
    const suffix =
        day % 10 === 1 && day !== 11
            ? "st"
            : day % 10 === 2 && day !== 12
              ? "nd"
              : day % 10 === 3 && day !== 13
                ? "rd"
                : "th";
    const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(date);
    const year = date.getUTCFullYear();
    return `${day}${suffix} ${month}, ${year}`;
}

function headingPattern(heading) {
    return new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
}

// Return a `##` section body without interpreting lower-level headings.
function findSection(markdown, heading) {
    const pattern = headingPattern(heading);
    const match = pattern.exec(markdown);
    if (!match) return undefined;

    const headingStart = match.index;
    const bodyStart = match.index + match[0].length;
    const rest = markdown.slice(bodyStart);
    const next = /^## .+$/m.exec(rest);
    const end = next ? bodyStart + next.index : markdown.length;

    return {
        headingStart,
        bodyStart,
        end,
        body: markdown.slice(bodyStart, end),
    };
}

function assertSingleUnreleased(markdown) {
    const matches = markdown.match(/^## Unreleased\s*$/gm) || [];
    if (matches.length !== 1) {
        fail(`Expected exactly one '## Unreleased' section in ${updatesPath}, found ${matches.length}.`);
    }
}

function prepare(version) {
    assertVersion(version);
    const markdown = readFileSync(updatesPath, "utf8");
    assertSingleUnreleased(markdown);

    if (headingPattern(version).test(markdown)) {
        fail(`Release notes for ${version} already exist in ${updatesPath}.`);
    }

    const unreleased = findSection(markdown, "Unreleased");
    if (!unreleased) fail(`Could not find '## Unreleased' in ${updatesPath}.`);

    const allowEmpty = process.env.ALLOW_EMPTY_UPDATES === "true";
    if (!allowEmpty && unreleased.body.trim() === "") {
        fail(`The '## Unreleased' section is empty. Set ALLOW_EMPTY_UPDATES=true if this is intentional.`);
    }

    // Keep a fresh empty Unreleased section above the newly dated release notes.
    const releasedBody = `${unreleased.body.trim()}\n\n`;
    const releaseDate = process.env.RELEASE_DATE || formatReleaseDate();
    const replacement = `## Unreleased\n\n## ${version}\n\n${releaseDate}\n\n${releasedBody}`;
    const nextMarkdown = markdown.slice(0, unreleased.headingStart) + replacement + markdown.slice(unreleased.end);
    writeFileSync(updatesPath, nextMarkdown, "utf8");
}

function validate(version) {
    assertVersion(version);

    const rootPackage = readJson("package.json");
    const manifest = readJson("manifest.json");
    if (rootPackage.version !== version) {
        fail(`package.json version is ${rootPackage.version}, expected ${version}.`);
    }
    if (manifest.version !== version) {
        fail(`manifest.json version is ${manifest.version}, expected ${version}.`);
    }

    for (const workspace of ["cli", "webpeer", "webapp"]) {
        const workspacePackage = readJson(`src/apps/${workspace}/package.json`);
        const expected = `${version}-${workspace}`;
        if (workspacePackage.version !== expected) {
            fail(`src/apps/${workspace}/package.json version is ${workspacePackage.version}, expected ${expected}.`);
        }
    }

    const versions = readJson("versions.json");
    if (versions[version] !== manifest.minAppVersion) {
        fail(`versions.json does not map ${version} to manifest minAppVersion ${manifest.minAppVersion}.`);
    }

    const markdown = readFileSync(updatesPath, "utf8");
    assertSingleUnreleased(markdown);

    const releaseSection = findSection(markdown, version);
    if (!releaseSection) {
        fail(`Could not find '## ${version}' in ${updatesPath}.`);
    }
    if (releaseSection.body.trim() === "") {
        fail(`The release notes for ${version} are empty.`);
    }
    if (/\b(?:TODO|WIP)\b/i.test(releaseSection.body)) {
        fail(`The release notes for ${version} still contain TODO or WIP markers.`);
    }
}

const [command, version] = process.argv.slice(2);
if (!command || !version) {
    fail("Usage: node utils/release-notes.mjs <prepare|validate> <version>");
}

if (command === "prepare") {
    prepare(version);
} else if (command === "validate") {
    validate(version);
} else {
    fail(`Unknown command: ${command}`);
}
