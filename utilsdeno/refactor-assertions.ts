// Refactor unnecessary type assertions (e.g. `expr as Type` where type of `expr` is already `Type`).
// Use this script by running `deno run --allow-read --allow-write --allow-env refactor-assertions.ts` from the utilsdeno directory.
// Run with --run flag to apply changes.
import { Project, SyntaxKind, Node } from "npm:ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDryRun = !Deno.args.includes("--run");

if (isDryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log(
        "To apply changes, run with: deno run --allow-read --allow-write --allow-env refactor-assertions.ts --run\n"
    );
} else {
    console.log("=== RUN MODE: WILL MODIFY FILES ===");
}

const project = new Project({ tsConfigFilePath: "../tsconfig.json" });
project.addSourceFilesAtPaths("../src/**/*.ts");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function toPosixPath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

const posixProjectRoot = toPosixPath(projectRoot);
const posixSrc = `${posixProjectRoot}/src`;

let modifiedFilesCount = 0;

for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const posixFilePath = toPosixPath(filePath);

    if (!posixFilePath.startsWith(posixSrc)) continue;
    if (posixFilePath.includes("/_test/") || posixFilePath.endsWith(".spec.ts") || posixFilePath.endsWith(".test.ts"))
        continue;

    // Find AsExpression (expr as Type) and TypeAssertion (<Type>expr)
    const asExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression);
    const typeAssertions = sourceFile.getDescendantsOfKind(SyntaxKind.TypeAssertion);
    const allAssertions = [...asExpressions, ...typeAssertions];

    const nodesToRemove: Node[] = [];

    for (const node of allAssertions) {
        const expr = node.getExpression();
        const exprType = expr.getType();
        const assertType = node.getType();

        // Skip `as const` or `<const>` assertions
        const typeNode = (node as any).getTypeNode?.();
        if (typeNode && typeNode.getText() === "const") {
            continue;
        }

        // Compare type texts to find redundant assertions
        const exprTypeText = exprType.getText();
        const assertTypeText = assertType.getText();

        if (exprTypeText === assertTypeText) {
            nodesToRemove.push(node);
        }
    }

    if (nodesToRemove.length > 0) {
        console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);

        // Reverse nodes order to keep indices/references valid when modifying
        const sortedNodes = [...nodesToRemove].sort((a, b) => b.getStart() - a.getStart());

        for (const node of sortedNodes) {
            const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
            const exprText = node.getExpression().getText();
            console.log(`  Line ${line}: "${node.getText()}" -> "${exprText}"`);

            if (!isDryRun) {
                node.replaceWithText(exprText);
            }
        }

        modifiedFilesCount++;
    }
}

console.log(`\nTotal files to modify: ${modifiedFilesCount}`);

if (!isDryRun) {
    project.saveSync();
    console.log("All changes successfully saved.");
} else {
    console.log("Dry run complete. No changes were written to files.");
}
