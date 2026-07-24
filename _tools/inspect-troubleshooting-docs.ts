import { access, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type InspectionError = {
    check: "current-label" | "local-reference" | "retired-label";
    file: string;
    detail: string;
};

export type TroubleshootingDocsInspection = {
    ok: boolean;
    checkedFiles: string[];
    checkedLocalReferences: number;
    errors: InspectionError[];
};

const guidePaths = ["docs/troubleshooting.md", "docs/recovery.md", "docs/tips/p2p-sync-tips.md"] as const;
const messageCataloguePath = "src/common/messagesJson/en.json";
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/gu;

function repositoryRootFromThisFile(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function normaliseReferenceTarget(rawTarget: string): string {
    const withoutAngles = rawTarget.startsWith("<") && rawTarget.endsWith(">") ? rawTarget.slice(1, -1) : rawTarget;
    return decodeURIComponent(withoutAngles);
}

function isExternalReference(target: string): boolean {
    return /^(?:https?:|mailto:|obsidian:)/u.test(target);
}

async function inspectLocalReferences(
    repositoryRoot: string,
    documentPath: string,
    document: string,
    errors: InspectionError[]
): Promise<number> {
    let checked = 0;
    for (const match of document.matchAll(markdownLinkPattern)) {
        const rawTarget = match[1];
        if (!rawTarget) continue;
        const target = normaliseReferenceTarget(rawTarget);
        if (isExternalReference(target) || target.startsWith("#")) continue;

        const [pathPart] = target.split("#", 1);
        if (!pathPart) continue;
        checked++;
        const referencedPath = resolve(repositoryRoot, dirname(documentPath), pathPart);
        try {
            await access(referencedPath);
        } catch {
            errors.push({
                check: "local-reference",
                file: documentPath,
                detail: `Missing local reference: ${relative(repositoryRoot, referencedPath)}`,
            });
        }
    }
    return checked;
}

export async function inspectTroubleshootingDocs(
    repositoryRoot = repositoryRootFromThisFile()
): Promise<TroubleshootingDocsInspection> {
    const errors: InspectionError[] = [];
    const documents = new Map<string, string>();
    for (const guidePath of guidePaths) {
        documents.set(guidePath, await readFile(resolve(repositoryRoot, guidePath), "utf8"));
    }

    const troubleshooting = documents.get("docs/troubleshooting.md")!;
    const catalogue = JSON.parse(await readFile(resolve(repositoryRoot, messageCataloguePath), "utf8")) as Record<
        string,
        string
    >;
    const requiredMessageKeys = [
        "TweakMismatchResolve.Action.UseConfigured",
        "TweakMismatchResolve.Action.UseMine",
        "TweakMismatchResolve.Action.UseRemote",
        "TweakMismatchResolve.Action.Dismiss",
        "obsidianLiveSyncSettingTab.titleSyncSettingsViaMarkdown",
    ] as const;

    for (const messageKey of requiredMessageKeys) {
        const label = catalogue[messageKey];
        if (!label) {
            errors.push({
                check: "current-label",
                file: messageCataloguePath,
                detail: `The English message catalogue does not define ${messageKey}.`,
            });
            continue;
        }
        if (!troubleshooting.includes(label)) {
            errors.push({
                check: "current-label",
                file: "docs/troubleshooting.md",
                detail: `The guide does not include the current UI label '${label}'.`,
            });
        }
    }

    for (const retiredLabel of ["`Update with mine`", "`Use configured`", "`Sync settings via Markdown files`"]) {
        if (troubleshooting.includes(retiredLabel)) {
            errors.push({
                check: "retired-label",
                file: "docs/troubleshooting.md",
                detail: `The guide still includes the retired label ${retiredLabel}.`,
            });
        }
    }

    let checkedLocalReferences = 0;
    for (const [guidePath, document] of documents) {
        checkedLocalReferences += await inspectLocalReferences(repositoryRoot, guidePath, document, errors);
    }

    return {
        ok: errors.length === 0,
        checkedFiles: [...guidePaths],
        checkedLocalReferences,
        errors,
    };
}

async function runCli(): Promise<void> {
    const result = await inspectTroubleshootingDocs();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
    await runCli();
}
