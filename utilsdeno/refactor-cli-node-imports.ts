// Refactor Node.js imports in the CLI application to use the barrel compatibility file.
// Use this script by running `deno run --allow-read --allow-write --allow-env refactor-cli-node-imports.ts` from the utilsdeno directory.
// Run with --run flag to apply changes.
import { Project, SyntaxKind, Node } from "npm:ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDryRun = !Deno.args.includes("--run");

if (isDryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log(
        "To apply changes, run with: deno run --allow-read --allow-write --allow-env refactor-cli-node-imports.ts --run\n"
    );
} else {
    console.log("=== RUN MODE: WILL MODIFY FILES ===");
}

const project = new Project({ tsConfigFilePath: "../tsconfig.json" });
project.addSourceFilesAtPaths("../src/apps/cli/**/*.ts");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const nodeCompatPath = path.resolve(projectRoot, "src", "apps", "cli", "node-compat.ts");

function toPosixPath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

const posixProjectRoot = toPosixPath(projectRoot);
const posixSrc = `${posixProjectRoot}/src`;

function getRelativeImportPath(fromFile: string, toFile: string): string {
    let rel = path.relative(path.dirname(fromFile), toFile);
    rel = rel.replace(/\\/g, "/");
    if (!rel.startsWith(".") && !rel.startsWith("/")) {
        rel = "./" + rel;
    }
    if (rel.endsWith(".ts")) {
        rel = rel.slice(0, -3);
    }
    return rel;
}

let modifiedFilesCount = 0;

for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const posixFilePath = toPosixPath(filePath);

    // Only process CLI source files under src/apps/cli/
    if (!posixFilePath.includes("/src/apps/cli/")) continue;
    if (
        posixFilePath.endsWith("node-compat.ts") ||
        posixFilePath.endsWith("vite.config.ts") ||
        posixFilePath.endsWith(".spec.ts") ||
        posixFilePath.endsWith(".test.ts") ||
        posixFilePath.includes("/_test/") ||
        posixFilePath.includes("/testdeno/") ||
        posixFilePath.includes("/test/")
    ) {
        continue;
    }

    const importDeclarations = sourceFile.getImportDeclarations();
    const targetImports: any[] = [];
    const namedImportsToAdd: string[] = [];

    for (const impDecl of importDeclarations) {
        const specifier = impDecl.getModuleSpecifierValue();

        // Check if it's a Node.js built-in module we want to redirect
        let exportedName = "";
        if (specifier === "fs/promises" || specifier === "node:fs/promises") {
            exportedName = "fsPromises";
        } else if (specifier === "fs" || specifier === "node:fs") {
            exportedName = "fs";
        } else if (specifier === "path" || specifier === "node:path") {
            exportedName = "path";
        } else if (specifier === "node:readline/promises") {
            exportedName = "readline";
        }

        if (exportedName) {
            const localName = impDecl.getNamespaceImport()?.getText() || impDecl.getDefaultImport()?.getText();
            if (localName) {
                targetImports.push({ impDecl, exportedName, localName });
            }
        }
    }

    if (targetImports.length > 0) {
        console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);

        for (const { impDecl, exportedName, localName } of targetImports) {
            const { line } = sourceFile.getLineAndColumnAtPos(impDecl.getStart());
            console.log(`  Line ${line}: Redirecting "${impDecl.getText()}"`);

            if (exportedName === localName) {
                namedImportsToAdd.push(exportedName);
            } else {
                namedImportsToAdd.push(`${exportedName} as ${localName}`);
            }

            if (!isDryRun) {
                impDecl.remove();
            }
        }

        const relImportPath = getRelativeImportPath(filePath, nodeCompatPath);
        console.log(`  Adding: import { ${namedImportsToAdd.join(", ")} } from "${relImportPath}"`);

        if (!isDryRun) {
            sourceFile.addImportDeclaration({
                namedImports: namedImportsToAdd,
                moduleSpecifier: relImportPath,
            });
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
