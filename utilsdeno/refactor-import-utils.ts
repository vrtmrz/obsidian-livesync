// Delete references to utils.ts and replace them with new imports based on the importMap.
// Use this script by running `deno run --allow-read --allow-write --allow-run refactor-import-utils.ts` from the utilsdeno directory.
import { Project } from "npm:ts-morph";

const isDryRun = !Deno.args.includes("--run");

if (isDryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log(
        "To apply changes, run with: deno run --allow-read --allow-write --allow-run refactor-import-utils.ts --run\n"
    );
}

// const project = new Project({ tsConfigFilePath: "../src/apps/cli/tsconfig.json" });
const project = new Project({ tsConfigFilePath: "../tsconfig.json" });

const importMap = new Map<string, string>();

const targetFiles = [
    "utils.concurrency.ts",
    "utils.timer.ts",
    "utils.notations.ts",
    "utils.database.ts",
    "utils.regexp.ts",
    "utils.settings.ts",
    "utils.patch.ts",
    "utils.misc.ts",
];

// 1. Map exports from our newly created subfiles
for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const fileName = sourceFile.getBaseName();
    if (filePath.includes("src/lib/src/common/") && targetFiles.includes(fileName)) {
        const exports = sourceFile.getExportedDeclarations();
        for (const [name] of exports) {
            const relativePath = filePath.split("src/lib/src/")[1].replace(/\.ts$/, "");
            importMap.set(name, `@lib/${relativePath}`);
        }
    }
}

// 2. Map exports/imports of octagonal-wheels in utils.ts
const utilsFile = project.getSourceFile("src/lib/src/common/utils.ts");
if (utilsFile) {
    // Parse imports from octagonal-wheels
    for (const imp of utilsFile.getImportDeclarations()) {
        const moduleSpec = imp.getModuleSpecifierValue();
        if (moduleSpec.startsWith("octagonal-wheels")) {
            for (const namedImport of imp.getNamedImports()) {
                importMap.set(namedImport.getName(), moduleSpec);
            }
        }
    }
    // Parse export declarations from octagonal-wheels
    for (const exp of utilsFile.getExportDeclarations()) {
        const moduleSpec = exp.getModuleSpecifierValue();
        if (moduleSpec && moduleSpec.startsWith("octagonal-wheels")) {
            for (const namedExport of exp.getNamedExports()) {
                importMap.set(namedExport.getName(), moduleSpec);
            }
        }
    }
}

console.log(`Built importMap with ${importMap.size} mappings.\n`);

let modifiedFilesCount = 0;

// 3. Loop through all source files and replace imports
for (const sourceFile of project.getSourceFiles()) {
    let fileModified = false;
    const imports = sourceFile.getImportDeclarations();

    for (const imp of imports) {
        const moduleSpec = imp.getModuleSpecifierValue();
        const isUtilsImport =
            moduleSpec === "@lib/common/utils" ||
            moduleSpec === "@lib/common/utils.ts" ||
            moduleSpec.endsWith("/common/utils") ||
            moduleSpec.endsWith("/common/utils.ts");

        if (isUtilsImport) {
            const namedImports = imp.getNamedImports();
            const defaultImport = imp.getDefaultImport();

            const importsToReplace: Record<string, { name: string; newPath: string; isTypeOnly: boolean }[]> = {};
            for (const namedImport of namedImports) {
                const name = namedImport.getName();
                let newPath = importMap.get(name);
                if (newPath) {
                    // If original ended with .ts and the new path starts with @lib, keep .ts
                    if (moduleSpec.endsWith(".ts") && newPath.startsWith("@lib/")) {
                        newPath = newPath + ".ts";
                    }
                    if (!importsToReplace[newPath]) {
                        importsToReplace[newPath] = [];
                    }
                    importsToReplace[newPath].push({
                        name,
                        newPath,
                        isTypeOnly: namedImport.isTypeOnly() || imp.isTypeOnly(),
                    });
                }
            }

            if (Object.keys(importsToReplace).length > 0 || (defaultImport && importMap.has(defaultImport.getText()))) {
                fileModified = true;

                console.log(`File: ${sourceFile.getFilePath().split("obsidian-livesync/")[1]}`);
                console.log(`  Old: ${imp.getText()}`);
            }

            if (!isDryRun) {
                // Apply replacements
                for (const newPath in importsToReplace) {
                    const isTypeOnly = importsToReplace[newPath].filter((i) => i.isTypeOnly);
                    if (isTypeOnly.length > 0) {
                        sourceFile.insertImportDeclaration(imp.getChildIndex(), {
                            namedImports: isTypeOnly.map((i) => i.name),
                            moduleSpecifier: newPath,
                            isTypeOnly: true,
                        });
                    }
                    const isValueImport = importsToReplace[newPath].filter((i) => !i.isTypeOnly);
                    if (isValueImport.length > 0) {
                        sourceFile.insertImportDeclaration(imp.getChildIndex(), {
                            namedImports: isValueImport.map((i) => i.name),
                            moduleSpecifier: newPath,
                            isTypeOnly: false,
                        });
                    }
                    for (const { name } of importsToReplace[newPath]) {
                        const namedImport = imp.getNamedImports().find((ni) => ni.getName() === name);
                        if (namedImport) {
                            namedImport.remove();
                        }
                    }
                }
            } else {
                // In dry run, just print what it would do
                for (const newPath in importsToReplace) {
                    const names = importsToReplace[newPath].map((i) => i.name).join(", ");
                    console.log(`  -> Would import { ${names} } from "${newPath}"`);
                }
            }

            if (defaultImport) {
                const name = defaultImport.getText();
                let newPath = importMap.get(name);
                if (newPath) {
                    if (moduleSpec.endsWith(".ts") && newPath.startsWith("@lib/")) {
                        newPath = newPath + ".ts";
                    }
                    if (!isDryRun) {
                        sourceFile.insertImportDeclaration(imp.getChildIndex(), {
                            defaultImport: name,
                            moduleSpecifier: newPath,
                            isTypeOnly: imp.isTypeOnly(),
                        });
                        imp.removeDefaultImport();
                    } else {
                        console.log(`  -> Would import default ${name} from "${newPath}"`);
                    }
                }
            }

            if (!isDryRun) {
                if (imp.getNamedImports().length === 0 && !imp.getDefaultImport()) {
                    imp.remove();
                }
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
