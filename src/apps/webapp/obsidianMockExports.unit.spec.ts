import { describe, expect, it } from "vitest";
import { fileURLToPath, path } from "@vrtmrz/livesync-commonlib/node";
import * as ts from "typescript";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dependencyFacadePath = path.resolve(repositoryRoot, "src/deps.ts");
const obsidianMockPath = path.resolve(repositoryRoot, "test/harness/obsidian-mock.ts");

describe("Webapp Obsidian mock exports", () => {
    it("provides every value re-exported from Obsidian", () => {
        const program = ts.createProgram([dependencyFacadePath, obsidianMockPath], {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            skipLibCheck: true,
            target: ts.ScriptTarget.ESNext,
        });
        const dependencyFacade = program.getSourceFile(dependencyFacadePath);
        const obsidianMock = program.getSourceFile(obsidianMockPath);
        expect(dependencyFacade).toBeDefined();
        expect(obsidianMock).toBeDefined();

        const requiredExports = new Set<string>();
        for (const statement of dependencyFacade!.statements) {
            if (
                ts.isExportDeclaration(statement) &&
                statement.moduleSpecifier &&
                ts.isStringLiteral(statement.moduleSpecifier) &&
                statement.moduleSpecifier.text === "obsidian" &&
                statement.exportClause &&
                ts.isNamedExports(statement.exportClause) &&
                !statement.isTypeOnly
            ) {
                for (const element of statement.exportClause.elements) {
                    if (!element.isTypeOnly) {
                        requiredExports.add((element.propertyName ?? element.name).text);
                    }
                }
            }
        }

        const checker = program.getTypeChecker();
        const mockSymbol = checker.getSymbolAtLocation(obsidianMock!);
        expect(mockSymbol).toBeDefined();
        const availableExports = new Set(checker.getExportsOfModule(mockSymbol!).map((symbol) => symbol.name));
        const missingExports = [...requiredExports].filter((name) => !availableExports.has(name)).sort();

        expect(missingExports).toEqual([]);
    });
});
