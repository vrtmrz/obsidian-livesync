import { pathToFileURL } from "node:url";

/**
 * Escape a value for use as inline Markdown code.
 *
 * Use a fence longer than any backtick run in the value so that branch names
 * supplied by a caller cannot break the surrounding Markdown.
 *
 * @param {string} value
 * @returns {string}
 */
function inlineCode(value) {
    const backtickRuns = value.match(/`+/g) ?? [];
    const fenceLength = Math.max(1, ...backtickRuns.map((run) => run.length + 1));
    const fence = "`".repeat(fenceLength);
    const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
    return `${fence}${padding}${value}${padding}${fence}`;
}

/**
 * Render the reader-facing checklist for a draft release pull request.
 *
 * The version decides whether publication is stable or pre-release. The base
 * branch is included explicitly because integration previews can target a
 * reviewed integration branch rather than `main`.
 *
 * @param {string} version
 * @param {string} baseBranch
 * @returns {string}
 */
export function renderReleasePrBody(version, baseBranch) {
    const selectedVersion = version.trim();
    const selectedBaseBranch = baseBranch.trim();
    if (selectedVersion.length === 0) throw new Error("A release version is required.");
    if (selectedBaseBranch.length === 0) throw new Error("A base branch is required.");

    const versionCode = inlineCode(selectedVersion);
    const baseBranchCode = inlineCode(selectedBaseBranch);
    const isPrerelease = selectedVersion.includes("-");
    const purpose = isPrerelease
        ? `an immutable pre-release for BRAT validation without replacing the latest stable release`
        : `the next stable release`;
    const finaliseInstruction = isPrerelease
        ? "Run the finalise release workflow with this PR's fixed head SHA and `prerelease=true`"
        : "Run the finalise release workflow with this PR's fixed head SHA and `prerelease=false`";
    const publicationInstruction = isPrerelease
        ? "Publish the GitHub Release as a pre-release without replacing the latest stable release, while keeping this pull request in draft"
        : "Publish the GitHub Release as the latest stable release while keeping this pull request in draft";

    return [
        `This release pull request prepares Self-hosted LiveSync ${versionCode} from ${baseBranchCode} as ${purpose}.`,
        "",
        "> [!IMPORTANT]",
        "> **Merge intentionally on hold**",
        ">",
        `> Publishing the GitHub Release does not unblock this pull request. Keep this pull request in draft, and leave ${baseBranchCode} unchanged, until the exact published build has passed BRAT validation.`,
        "",
        "## Release checklist",
        "",
        "- [ ] Review and polish `updates.md`",
        "- [ ] Confirm the release date",
        "- [ ] Confirm `manifest.json`, `versions.json`, workspace package versions, and the locked Commonlib package version",
        "- [ ] Confirm CI has passed",
        `- [ ] ${finaliseInstruction}`,
        "- [ ] Confirm the draft GitHub Release assets and the published CLI image, if selected",
        `- [ ] ${publicationInstruction}`,
        "- [ ] Validate the exact published release with BRAT",
        `- [ ] Mark this pull request ready and merge it into ${baseBranchCode} with a merge commit`,
        "",
    ].join("\n");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
    const [, , version, baseBranch] = process.argv;
    try {
        process.stdout.write(renderReleasePrBody(version ?? "", baseBranch ?? ""));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
