// Refactor unused catch variables and unused imports in the codebase.
// Use this script by running `deno run --allow-read --allow-write --allow-env refactor-unused.ts` from the utilsdeno directory.
// Run with --run flag to apply changes.
import { Project, SyntaxKind, Node } from "npm:ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDryRun = !Deno.args.includes("--run");

if (isDryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log(
        "To apply changes, run with: deno run --allow-read --allow-write --allow-env refactor-unused.ts --run\n"
    );
} else {
    console.log("=== RUN MODE: WILL MODIFY FILES ===");
}

const project = new Project({ tsConfigFilePath: "../tsconfig.json" });
// Only add .ts files to avoid Svelte-markup-blindness references
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

    let fileModified = false;

    // 1. Find unused catch variables: catch (error) -> catch
    const catchClauses = sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause);
    const catchVarsToRemove: Node[] = [];

    for (const catchClause of catchClauses) {
        const varDec = catchClause.getVariableDeclaration();
        if (varDec) {
            const varName = varDec.getName();
            // Count references within the catch clause itself
            const count = catchClause
                .getDescendantsOfKind(SyntaxKind.Identifier)
                .filter((id) => id.getText() === varName).length;
            if (count === 1) {
                // Only the declaration itself
                catchVarsToRemove.push(varDec);
            }
        }
    }

    if (catchVarsToRemove.length > 0) {
        if (!fileModified) {
            console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);
            fileModified = true;
        }
        for (const varDec of catchVarsToRemove) {
            const { line } = sourceFile.getLineAndColumnAtPos(varDec.getStart());
            console.log(`  Line ${line}: Unused catch variable "${varDec.getText()}" -> Remove it`);
            if (!isDryRun) {
                varDec.remove();
            }
        }
    }

    // 2. Find unused named imports
    const importDeclarations = sourceFile.getImportDeclarations();
    const importsToRemove: { namedImport: any; impDecl: any }[] = [];
    const modifiedDecls = new Set<any>();

    for (const impDecl of importDeclarations) {
        const namedImports = impDecl.getNamedImports();
        if (namedImports.length === 0) continue;

        for (const namedImport of namedImports) {
            const importName = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
            // Count references in the entire file
            const count = sourceFile
                .getDescendantsOfKind(SyntaxKind.Identifier)
                .filter((id) => id.getText() === importName).length;
            if (count === 1) {
                // Only the import specifier itself
                importsToRemove.push({ namedImport, impDecl });
            }
        }
    }

    if (importsToRemove.length > 0) {
        if (!fileModified) {
            console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);
            fileModified = true;
        }
        for (const { namedImport, impDecl } of importsToRemove) {
            const { line } = sourceFile.getLineAndColumnAtPos(namedImport.getStart());
            console.log(`  Line ${line}: Unused named import "${namedImport.getText()}" -> Remove it`);
            if (!isDryRun) {
                namedImport.remove();
                modifiedDecls.add(impDecl);
            }
        }
    }

    // 3. Clean up empty import declarations (only those we actually modified)
    if (!isDryRun && fileModified && modifiedDecls.size > 0) {
        for (const impDecl of modifiedDecls) {
            if (
                impDecl.getNamedImports().length === 0 &&
                !impDecl.getDefaultImport() &&
                !impDecl.getNamespaceImport()
            ) {
                impDecl.remove();
            }
        }
    }

    if (fileModified) {
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
