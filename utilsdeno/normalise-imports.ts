// Normalise import and export paths in the codebase to use @lib/ and @/ aliases correctly.
// Use this script by running `deno run --allow-read --allow-write normalise-imports.ts` from the utilsdeno directory.
// Set the --run flag to apply changes: `deno run --allow-read --allow-write normalise-imports.ts --run`
// Set the --all-alias flag to also normalise sibling/child imports (starting with ./): `deno run --allow-read --allow-write normalise-imports.ts --all-alias`

import { Project } from "npm:ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDryRun = !Deno.args.includes("--run");
const allAlias = Deno.args.includes("--all-alias");

if (isDryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log("To apply changes, run with: deno run --allow-read --allow-write normalise-imports.ts --run\n");
} else {
    console.log("=== RUN MODE: WILL MODIFY FILES ===");
}

if (allAlias) {
    console.log("Option --all-alias is active: Sibling imports (starting with ./) will also be normalised to @/.\n");
} else {
    console.log("Sibling imports (starting with ./) will be left relative.\n");
}

const project = new Project({ tsConfigFilePath: "../tsconfig.json" });

// Manually add files under src/ to ensure those excluded by tsconfig.json (e.g. src/apps) are processed.
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
const posixLibSrc = `${posixProjectRoot}/src/lib/src`;
const posixSubrepo = `${posixProjectRoot}/src/lib`;

console.log(`Project Root: ${posixProjectRoot}`);
console.log(`Source Directory: ${posixSrc}`);
console.log(`Library Source Directory: ${posixLibSrc}`);
console.log("");

let modifiedFilesCount = 0;

for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const posixFilePath = toPosixPath(filePath);
    const fileDir = path.dirname(posixFilePath);

    // Only process files inside the project src directory.
    if (!posixFilePath.startsWith(posixSrc)) {
        // console.log(`Skipping outside src: ${posixFilePath}`);
        continue;
    }

    // Skip files inside directories starting with an underscore (e.g., _tools, _test).
    const dirSegments = fileDir.split("/");
    const isUnderscore = dirSegments.some((segment) => segment.startsWith("_"));
    if (isUnderscore) {
        // console.log(`Skipping underscore dir: ${posixFilePath}`);
        continue;
    }

    let fileModified = false;
    const imports = sourceFile.getImportDeclarations();
    const exports = sourceFile.getExportDeclarations();
    const declarations = [...imports, ...exports];

    for (const decl of declarations) {
        let moduleSpecifier: string | undefined;
        try {
            moduleSpecifier = decl.getModuleSpecifierValue();
        } catch (_err) {
            // Gracefully skip declarations that do not have a standard string literal specifier.
            continue;
        }
        if (!moduleSpecifier) {
            continue;
        }

        // Determine if it is an internal import.
        const isRelative = moduleSpecifier.startsWith(".");
        const isAlias = moduleSpecifier.startsWith("@/") || moduleSpecifier.startsWith("@lib/");

        if (!isRelative && !isAlias) {
            // Skip external packages/modules.
            continue;
        }

        // Resolve path to an absolute POSIX path.
        let resolvedPath = "";
        if (moduleSpecifier.startsWith("@lib/")) {
            resolvedPath = `${posixLibSrc}/${moduleSpecifier.slice(5)}`;
        } else if (moduleSpecifier.startsWith("@/")) {
            resolvedPath = `${posixSrc}/${moduleSpecifier.slice(2)}`;
        } else {
            // Relative path.
            resolvedPath = path.resolve(fileDir, moduleSpecifier);
        }

        resolvedPath = toPosixPath(path.normalize(resolvedPath));

        // Keep relative sibling/child imports unchanged (e.g. ./utils) unless:
        // 1. --all-alias is set, OR
        // 2. the import crosses the subrepository boundary (src/lib/)
        const isSibling = isRelative && !moduleSpecifier.startsWith("..");
        const importerInsideSubrepo = posixFilePath.startsWith(posixSubrepo + "/");
        const targetInsideSubrepo = resolvedPath.startsWith(posixSubrepo + "/");
        const crossesSubrepo = importerInsideSubrepo !== targetInsideSubrepo;
        if (isSibling && !allAlias && !crossesSubrepo) {
            continue;
        }

        // Determine correct normalised specifier.
        let newSpecifier = "";
        const hasExtension =
            moduleSpecifier.endsWith(".ts") ||
            moduleSpecifier.endsWith(".js") ||
            moduleSpecifier.endsWith(".svelte") ||
            moduleSpecifier.endsWith(".d.ts");

        if (resolvedPath.startsWith(posixLibSrc + "/")) {
            let rel = resolvedPath.slice(posixLibSrc.length + 1);
            if (!hasExtension && (rel.endsWith(".ts") || rel.endsWith(".js"))) {
                // Strip extension if the original import did not have one.
                if (rel.endsWith(".ts") && !rel.endsWith(".d.ts")) {
                    rel = rel.slice(0, -3);
                } else if (rel.endsWith(".js")) {
                    rel = rel.slice(0, -3);
                }
            }
            newSpecifier = `@lib/${rel}`;
        } else if (resolvedPath.startsWith(posixSrc + "/")) {
            let rel = resolvedPath.slice(posixSrc.length + 1);
            if (!hasExtension && (rel.endsWith(".ts") || rel.endsWith(".js"))) {
                // Strip extension if the original import did not have one.
                if (rel.endsWith(".ts") && !rel.endsWith(".d.ts")) {
                    rel = rel.slice(0, -3);
                } else if (rel.endsWith(".js")) {
                    rel = rel.slice(0, -3);
                }
            }

            newSpecifier = `@/${rel}`;
        } else {
            // Target is outside the src directory (e.g. root configs or tests).
            continue;
        }

        // Update module specifier if different.
        if (newSpecifier && newSpecifier !== moduleSpecifier) {
            if (!fileModified) {
                console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);
                fileModified = true;
            }
            console.log(`  - "${moduleSpecifier}" -> "${newSpecifier}"`);

            if (!isDryRun) {
                decl.setModuleSpecifier(newSpecifier);
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
