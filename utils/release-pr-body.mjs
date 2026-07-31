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
 * The version decides whether the release commit is an immutable SemVer
 * pre-release or a stable version staged through a GitHub pre-release. The
 * base branch is included explicitly because integration previews can target
 * a reviewed integration branch rather than `main`.
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
        : `a stable version which will first be staged as a GitHub pre-release for BRAT validation`;
    const finaliseInstruction = isPrerelease
        ? "Run the finalise release workflow with this PR's fixed head SHA and `prerelease=true`"
        : "Run the finalise release workflow with this PR's fixed head SHA, `prerelease=true`, and `publish_cli=false`";
    const publicationInstruction = isPrerelease
        ? "Publish the GitHub Release as a pre-release without replacing the latest stable release, while keeping this pull request in draft"
        : "Publish the GitHub Release initially as a pre-release without replacing the latest stable release, while keeping this pull request in draft";
    const assetInstruction = isPrerelease
        ? "Confirm the draft GitHub Release assets and the published CLI image, if selected"
        : "Confirm the draft GitHub Release assets; keep stable CLI publication deferred until BRAT validation passes";
    const holdInstruction = isPrerelease
        ? `Publishing and validating this pre-release does not unblock this pull request. Keep it in draft and unmerged, and leave ${baseBranchCode} unchanged.`
        : `Publishing the GitHub pre-release does not unblock this pull request. Keep it in draft, and leave ${baseBranchCode} unchanged, until the exact published build has passed BRAT validation. Before the exact release commit reaches the repository's default branch, remove the pre-release designation and make this exact release the latest stable release so Community Directory review does not inspect a manifest version whose GitHub Release remains a pre-release.`;
    const completionInstructions = isPrerelease
        ? ["- [ ] Keep this pre-release pull request unmerged; close it only through a separate maintainer action"]
        : [
              "- [ ] After BRAT validation passes, remove the pre-release designation and make this exact release the latest stable release",
              `- [ ] Confirm this exact release is no longer a pre-release, then mark this pull request ready and merge it into ${baseBranchCode} with a merge commit`,
              "- [ ] Integrate the exact release commit through the reviewed branch chain into the repository's default branch",
              "- [ ] Confirm the default branch contains the exact release commit and metadata",
              "- [ ] Create the stable CLI tag and publish its `latest` and major-minor image tags, if selected, through a separate maintainer gate",
          ];

    return [
        `This release pull request prepares Self-hosted LiveSync ${versionCode} from ${baseBranchCode} as ${purpose}.`,
        "",
        "> [!IMPORTANT]",
        "> **Merge intentionally on hold**",
        ">",
        `> ${holdInstruction}`,
        "",
        "## Release checklist",
        "",
        "- [ ] Review and polish `updates.md`",
        "- [ ] Confirm the release date",
        "- [ ] Confirm `manifest.json`, `versions.json`, workspace package versions, and the locked Commonlib package version",
        "- [ ] Confirm CI has passed",
        `- [ ] ${finaliseInstruction}`,
        `- [ ] ${assetInstruction}`,
        `- [ ] ${publicationInstruction}`,
        "- [ ] Validate the exact published release with BRAT",
        ...completionInstructions,
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
