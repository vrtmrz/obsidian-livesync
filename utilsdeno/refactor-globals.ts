// Refactor global variables (setTimeout, document, navigator, etc.) to use compatGlobal.
// Use this script by running `deno run --allow-read --allow-write --allow-run refactor-globals.ts` from the utilsdeno directory.
// Run with --run flag to apply changes.
import { Project, SyntaxKind, Node } from "npm:ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDryRun = !Deno.args.includes("--run");

if (isDryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log(
        "To apply changes, run with: deno run --allow-read --allow-write --allow-run refactor-globals.ts --run\n"
    );
} else {
    console.log("=== RUN MODE: WILL MODIFY FILES ===");
}

const project = new Project({ tsConfigFilePath: "../tsconfig.json" });

// Manually add files under src/ to ensure those excluded by tsconfig.json are processed if needed.
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
const posixLibSrc = `${posixProjectRoot}/src/lib`;

const TARGET_GLOBALS = new Set([
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "localStorage",
    "navigator",
    "location",
    "document",
    "window",
]);

let modifiedFilesCount = 0;

for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const posixFilePath = toPosixPath(filePath);

    // Only process files inside the project src directory.
    if (!posixFilePath.startsWith(posixSrc)) {
        continue;
    }

    // Exclude coreEnvFunctions.ts to avoid self-referential definitions
    if (posixFilePath.endsWith("/coreEnvFunctions.ts") || posixFilePath.endsWith("/coreEnvFunctions")) {
        continue;
    }

    // Exclude unit and integration test files
    if (
        posixFilePath.endsWith(".spec.ts") ||
        posixFilePath.endsWith(".test.ts") ||
        posixFilePath.includes("/_test/") ||
        posixFilePath.includes("/testdeno/")
    ) {
        continue;
    }

    // Collect all identifier nodes
    const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
    const nodesToReplace: { node: Node; replacement: string }[] = [];

    for (const idNode of identifiers) {
        const name = idNode.getText();
        if (!TARGET_GLOBALS.has(name)) {
            continue;
        }

        const parent = idNode.getParent();
        if (!parent) {
            continue;
        }

        // 1. Skip if it is the property name in a PropertyAccessExpression (e.g. the "setTimeout" in "obj.setTimeout")
        if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
            const propAccess = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
            if (propAccess.getNameNode() === idNode) {
                continue;
            }
        }

        // 1.5. Skip if it is the right-hand side of a QualifiedName (e.g. the "requestAnimationFrame" in "typeof compatGlobal.requestAnimationFrame")
        if (parent.getKind() === SyntaxKind.QualifiedName) {
            const qualified = parent.asKindOrThrow(SyntaxKind.QualifiedName);
            if (qualified.getRight() === idNode) {
                continue;
            }
        }

        // 2. Skip if it is the operand of a typeof expression (e.g. "typeof window")
        if (parent.getKind() === SyntaxKind.TypeOfExpression) {
            continue;
        }

        // 3. Skip if it is a declaration name node
        const kind = parent.getKind();
        if (
            kind === SyntaxKind.VariableDeclaration ||
            kind === SyntaxKind.Parameter ||
            kind === SyntaxKind.FunctionDeclaration ||
            kind === SyntaxKind.MethodDeclaration ||
            kind === SyntaxKind.PropertyDeclaration ||
            kind === SyntaxKind.ClassDeclaration ||
            kind === SyntaxKind.InterfaceDeclaration ||
            kind === SyntaxKind.TypeAliasDeclaration ||
            kind === SyntaxKind.ImportSpecifier ||
            kind === SyntaxKind.ExportSpecifier ||
            kind === SyntaxKind.MethodSignature ||
            kind === SyntaxKind.PropertySignature ||
            kind === SyntaxKind.PropertyAssignment
        ) {
            if ((parent as any).getNameNode?.() === idNode || (parent as any).getName?.() === name) {
                continue;
            }
        }

        // 4. Verify it is a global variable reference using definitions
        let isGlobal = false;
        try {
            const definitions = idNode.getDefinitions();
            isGlobal =
                definitions.length === 0 ||
                definitions.every((def) => {
                    const sf = def.getSourceFile();
                    if (!sf) return true;
                    const path = sf.getFilePath();
                    return path.includes("node_modules/typescript/lib/") || path.includes("node_modules/@types/");
                });
        } catch (_err) {
            // If checking definitions fails, assume it is local/imported to be safe
            isGlobal = false;
        }

        if (!isGlobal) {
            continue;
        }

        // Determine replacement
        let replacement = "";
        if (name === "window" || name === "globalThis") {
            replacement = "compatGlobal";
        } else if (name === "document") {
            replacement = "_activeDocument";
        } else {
            replacement = `compatGlobal.${name}`;
        }

        nodesToReplace.push({ node: idNode, replacement });
    }

    if (nodesToReplace.length > 0) {
        console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);
        for (const { node, replacement } of nodesToReplace) {
            const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
            console.log(`  Line ${line}: "${node.getText()}" -> "${replacement}"`);
        }

        if (!isDryRun) {
            // Apply replacements
            // Note: replaceWithText changes AST, so we replace them directly
            for (const { node, replacement } of nodesToReplace) {
                node.replaceWithText(replacement);
            }

            // Determine what needs to be imported based on replacements
            const needsCompatGlobal = nodesToReplace.some((r) => r.replacement.includes("compatGlobal"));
            const needsActiveDocument = nodesToReplace.some((r) => r.replacement.includes("_activeDocument"));

            const requiredImports: string[] = [];
            if (needsCompatGlobal) requiredImports.push("compatGlobal");
            if (needsActiveDocument) requiredImports.push("_activeDocument");

            if (requiredImports.length > 0) {
                const existingImport = sourceFile.getImportDeclarations().find((imp) => {
                    const spec = imp.getModuleSpecifierValue();
                    return spec === "@lib/common/coreEnvFunctions" || spec === "@lib/common/coreEnvFunctions.ts";
                });

                if (existingImport) {
                    for (const nameToImport of requiredImports) {
                        const alreadyImported = existingImport
                            .getNamedImports()
                            .some((ni) => ni.getName() === nameToImport);
                        if (!alreadyImported) {
                            existingImport.addNamedImport(nameToImport);
                        }
                    }
                } else {
                    sourceFile.addImportDeclaration({
                        namedImports: requiredImports,
                        moduleSpecifier: "@lib/common/coreEnvFunctions.ts",
                    });
                }
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
