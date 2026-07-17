import { describe, expect, it } from "vitest";
import { fileURLToPath, path } from "@vrtmrz/livesync-commonlib/node";
import * as ts from "typescript";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dependencyFacadePath = path.resolve(repositoryRoot, "src/deps.ts");
const obsidianMockPath = path.resolve(repositoryRoot, "test/harness/obsidian-mock.ts");

function parseSourceFile(filePath: string): ts.SourceFile {
    const source = ts.sys.readFile(filePath);
    if (source === undefined) throw new Error(`Could not read ${filePath}`);
    return ts.createSourceFile(filePath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

function hasExportModifier(statement: ts.Statement): boolean {
    return ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function addBindingNames(name: ts.BindingName, names: Set<string>): void {
    if (ts.isIdentifier(name)) {
        names.add(name.text);
        return;
    }
    for (const element of name.elements) {
        if (!ts.isOmittedExpression(element)) addBindingNames(element.name, names);
    }
}

describe("Webapp Obsidian mock exports", () => {
    it("provides every value re-exported from Obsidian", () => {
        const dependencyFacade = parseSourceFile(dependencyFacadePath);
        const obsidianMock = parseSourceFile(obsidianMockPath);

        const requiredExports = new Set<string>();
        for (const statement of dependencyFacade.statements) {
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

        const availableExports = new Set<string>();
        for (const statement of obsidianMock.statements) {
            if (
                ts.isExportDeclaration(statement) &&
                !statement.isTypeOnly &&
                statement.exportClause &&
                ts.isNamedExports(statement.exportClause)
            ) {
                for (const element of statement.exportClause.elements) {
                    if (!element.isTypeOnly) availableExports.add(element.name.text);
                }
                continue;
            }
            if (!hasExportModifier(statement)) continue;
            if (
                (ts.isClassDeclaration(statement) ||
                    ts.isFunctionDeclaration(statement) ||
                    ts.isEnumDeclaration(statement)) &&
                statement.name
            ) {
                availableExports.add(statement.name.text);
            } else if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    addBindingNames(declaration.name, availableExports);
                }
            }
        }
        const missingExports = [...requiredExports].filter((name) => !availableExports.has(name)).sort();

        expect(missingExports).toEqual([]);
    });
});
