import { Project, SyntaxKind } from "npm:ts-morph";

function processFile(filePath: string,origin: string, repoHash: string): string {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(filePath);
    // 0. insert a commit hash comment at the top of the file
    sourceFile.insertText(0, `// REPO: ${origin}  Commit hash: ${repoHash}\n`);
    
    // 1. Collect all 'any' type nodes in the file
    const anyTypeNodes = sourceFile.getDescendantsOfKind(SyntaxKind.AnyKeyword);
    const sourceText = sourceFile.getFullText();
    const lineBreak = sourceText.includes("\r\n") ? "\r\n" : "\n";
    const lines = sourceText.split(/\r?\n/);
    const targetLines = new Set<number>();
    let updated = false;

    // 2. Collect the line numbers that contain 'any'
    anyTypeNodes.forEach((anyNode: any) => {
        const { line } = sourceFile.getLineAndColumnAtPos(anyNode.getStart());
        targetLines.add(line - 1);
    });

    // 3. Add an inline disable only to lines that contain 'any'
    for (const lineIndex of targetLines) {
        const line = lines[lineIndex];
        if (!line) {
            continue;
        }
        if (line.includes("eslint-disable-line @typescript-eslint/no-explicit-any")) {
            continue;
        }
        lines[lineIndex] = `${line} // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration`;
        updated = true;
    }

    const updatedSourceText = lines.join(lineBreak);
    if (updated) {
        console.log(`Processed file: ${filePath}`);
    }
    // Output the result
    return updatedSourceText;
}

const targetDir = `./_types`;

async function processDir(dirPath: string) {
    for await (const entry of Deno.readDir(dirPath)) {
        if (entry.isDirectory) {
            await processDir(`${dirPath}/${entry.name}`);
        }
        if (entry.isFile && entry.name.endsWith(".d.ts")) {
            const filePath = `${dirPath}/${entry.name}`;
            console.log(`Processing: ${filePath}`);
            const updatedContent = processFile(filePath, repoRemoteOriginStr, gitCommitHashStr);
            // Write the file. To revert, regenerate it with npm run lib:build:types.
            await Deno.writeTextFile(filePath, updatedContent);
        }
    }
}

const subDir = "./src/lib/";
const repoRemoteOrigins = new Deno.Command("git", {
    args: ["remote", "get-url", "origin"],
    cwd: subDir,
    stdout: "piped",
}).outputSync().stdout;
const repoRemoteOriginStr = new TextDecoder().decode(repoRemoteOrigins).trim();
console.log(`STAMP: Git remote origin: ${repoRemoteOriginStr}`);
const gitCommitHashSub = new Deno.Command("git", {
    args: ["rev-parse", "--short", "HEAD"],
    cwd: subDir,
    stdout: "piped",
}).outputSync().stdout;
const gitCommitHashStr = new TextDecoder().decode(gitCommitHashSub).trim();
console.log(`STAMP: Git commit hash: ${gitCommitHashStr}`);
await processDir(targetDir);
