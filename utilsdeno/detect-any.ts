// Detect explicit usage of 'any' type in the codebase.
// Use this script by running `deno run --allow-read --allow-env detect-any.ts` from the utilsdeno directory.
import { Project, SyntaxKind } from "npm:ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = new Project({ tsConfigFilePath: "../tsconfig.json" });
project.addSourceFilesAtPaths("../src/**/*.ts");
project.addSourceFilesAtPaths("../src/**/*.svelte");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function toPosixPath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

const posixProjectRoot = toPosixPath(projectRoot);
const posixSrc = `${posixProjectRoot}/src`;

let anyCount = 0;

for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const posixFilePath = toPosixPath(filePath);

    if (!posixFilePath.startsWith(posixSrc)) continue;
    if (posixFilePath.includes("/_test/") || posixFilePath.endsWith(".spec.ts") || posixFilePath.endsWith(".test.ts")) {
        continue;
    }

    const anyNodes = sourceFile.getDescendantsOfKind(SyntaxKind.AnyKeyword);
    if (anyNodes.length > 0) {
        console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);
        for (const anyNode of anyNodes) {
            const { line } = sourceFile.getLineAndColumnAtPos(anyNode.getStart());
            const lineText = sourceFile.getFullText().split(/\r?\n/)[line - 1];
            console.log(`  Line ${line}: ${lineText.trim()}`);
            anyCount++;
        }
    }
}

console.log(`\nTotal explicit 'any' usages found: ${anyCount}`);
