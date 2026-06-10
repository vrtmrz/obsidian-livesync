// Delete references to types.ts and replace them with new imports based on the importMap. It will also split imports if some are type-only and some are value imports.
// Use this script by running `deno run --allow-read --allow-write --allow-run refactor-imports.ts` from the utilsdeno directory. It will read all source files, find imports from types.ts, and replace them with the new paths based on the importMap. Make sure to review the changes before saving, as it will modify your source files.
import { Project } from "npm:ts-morph";

const project = new Project({ tsConfigFilePath: "../tsconfig.json" });

const importMap = new Map<string, string>();
// Build a map of types moved out of Models.
// Under src/lib/src/common/models.
for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes("src/lib/src/common/models")) {
        const exports = sourceFile.getExportedDeclarations();
        for (const [name, declarations] of exports) {
            for (const declaration of declarations) {
                if (
                    // declaration.getKindName() === "TypeAliasDeclaration" ||
                    // declaration.getKindName() === "InterfaceDeclaration" ||
                    // declaration.getKindName() === "EnumDeclaration" ||
                    true
                ) {
                    console.log(`Found type export in ${sourceFile.getFilePath()}:`, name);
                    const relativePath = sourceFile.getFilePath().split("src/lib/src/")[1].replace(/\.ts$/, "");
                    importMap.set(name, `@lib/${relativePath}`);
                }
            }
        }
    }
}
// Extras

importMap.set("LOG_LEVEL_NOTICE", "@lib/common/logger");
importMap.set("LOG_LEVEL_VERBOSE", "@lib/common/logger");
importMap.set("LOG_LEVEL_INFO", "@lib/common/logger");
importMap.set("LOG_LEVEL_DEBUG", "@lib/common/logger");
importMap.set("LOG_LEVEL_URGENT", "@lib/common/logger");
importMap.set("LOG_LEVEL", "@lib/common/logger");
importMap.set("Logger", "@lib/common/logger");

console.log("Import map:", importMap);

// Loop through all files that import from types.ts.
for (const sourceFile of project.getSourceFiles()) {
    const imports = sourceFile.getImportDeclarations();

    for (const imp of imports) {
        if (
            imp.getModuleSpecifierValue().includes("types.ts") &&
            imp.getModuleSpecifierValue().startsWith("@lib/common/")
        ) {
            // Collect imports from types.ts.
            const namedImports = imp.getNamedImports();
            const defaultImport = imp.getDefaultImport();
            console.log(`Found import in ${sourceFile.getFilePath()}:`, {
                namedImports: namedImports.map((ni) => ni.getText()),
                defaultImport: defaultImport ? defaultImport.getText() : null,
            });
            // Group imports by their names and generate new import paths based on the importMap
            const importsToReplace: Record<string, { name: string; newPath: string; isTypeOnly: boolean }[]> = {};
            for (const namedImport of namedImports) {
                const name = namedImport.getName();
                const newPath = importMap.get(name);
                if (newPath) {
                    console.log(
                        `Will replace import of ${name} in ${sourceFile.getFilePath()} with new path:`,
                        newPath
                    );
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

            // For each import, generate a new path from importMap and replace it.
            // Split the import when it needs to become multiple imports.

            for (const newPath in importsToReplace) {
                // First, handle type-only imports.
                const isTypeOnly = importsToReplace[newPath].filter((i) => i.isTypeOnly);
                if (isTypeOnly.length > 0) {
                    sourceFile.insertImportDeclaration(imp.getChildIndex(), {
                        namedImports: isTypeOnly.map((i) => i.name),
                        moduleSpecifier: newPath,
                        isTypeOnly: true,
                    });
                }
                // Then, handle non-type-only imports.
                const isValueImport = importsToReplace[newPath].filter((i) => !i.isTypeOnly);
                if (isValueImport.length > 0) {
                    sourceFile.insertImportDeclaration(imp.getChildIndex(), {
                        namedImports: isValueImport.map((i) => i.name),
                        moduleSpecifier: newPath,
                        isTypeOnly: false,
                    });
                }
                // Remove the replaced named imports from the old import.
                for (const { name } of importsToReplace[newPath]) {
                    const namedImport = imp.getNamedImports().find((ni) => ni.getName() === name);
                    if (namedImport) {
                        namedImport.remove();
                    }
                }
            }
            // If there is also a default import and it exists in importMap, replace it too.
            if (defaultImport) {
                const name = defaultImport.getText();
                const newPath = importMap.get(name);

                if (newPath) {
                    console.log(
                        `Replacing default import of ${name} in ${sourceFile.getFilePath()} with new path:`,
                        newPath
                    );
                    // Add the new import statement.
                    sourceFile.insertImportDeclaration(imp.getChildIndex(), {
                        defaultImport: name,
                        moduleSpecifier: newPath,
                        isTypeOnly: imp.isTypeOnly(),
                    });
                    // Remove the default import from the old import.
                    imp.removeDefaultImport();
                }
            }
            if (imp.getNamedImports().length === 0 && !imp.getDefaultImport()) {
                // Delete the entire import statement if nothing remains.
                imp.remove();
            }
        }
    }
}

// Save everything at the end.
project.saveSync();
