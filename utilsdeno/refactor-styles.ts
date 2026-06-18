// Refactor element.style.XXXX = YYYY to element.setCssStyles({ XXXX: YYYY }).
// Use this script by running `deno run --allow-read --allow-write --allow-run refactor-styles.ts` from the utilsdeno directory.
// Run with --run flag to apply changes.
import { Project, SyntaxKind, Node, Expression } from "npm:ts-morph";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDryRun = !Deno.args.includes("--run");

if (isDryRun) {
    console.log("=== DRY RUN MODE ===");
    console.log(
        "To apply changes, run with: deno run --allow-read --allow-write --allow-run refactor-styles.ts --run\n"
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

function matchStyleAccess(node: Node): { element: Node; propertyName: string; isComputed: boolean } | undefined {
    if (Node.isPropertyAccessExpression(node)) {
        const expr = node.getExpression();
        if (Node.isPropertyAccessExpression(expr) && expr.getName() === "style") {
            return {
                element: expr.getExpression(),
                propertyName: node.getName(),
                isComputed: false,
            };
        }
    } else if (Node.isElementAccessExpression(node)) {
        const expr = node.getExpression();
        if (Node.isPropertyAccessExpression(expr) && expr.getName() === "style") {
            const arg = node.getArgumentExpression();
            if (arg) {
                return {
                    element: expr.getExpression(),
                    propertyName: arg.getText(),
                    isComputed: true,
                };
            }
        }
    }
    return undefined;
}

function getStyleAssignment(statement: Node) {
    if (!Node.isExpressionStatement(statement)) return undefined;
    const expr = statement.getExpression();
    if (!Node.isBinaryExpression(expr)) return undefined;
    if (expr.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return undefined;

    const styleAccess = matchStyleAccess(expr.getLeft());
    if (!styleAccess) return undefined;

    return {
        elementText: styleAccess.element.getText(),
        property: styleAccess.propertyName,
        valueText: expr.getRight().getText(),
        isComputed: styleAccess.isComputed,
        statementNode: statement,
    };
}

interface StyleGroup {
    elementText: string;
    assignments: {
        property: string;
        valueText: string;
        isComputed: boolean;
        statementNode: Node;
    }[];
}

let modifiedFilesCount = 0;

for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const posixFilePath = toPosixPath(filePath);

    // Only process files inside the project src directory.
    if (!posixFilePath.startsWith(posixSrc)) {
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

    // Collect all blocks, case clauses, and the source file itself
    const containers = [
        sourceFile,
        ...sourceFile.getDescendantsOfKind(SyntaxKind.Block),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.CaseClause),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.DefaultClause),
    ];

    const fileGroups: StyleGroup[] = [];

    for (const container of containers) {
        const statements = container.getStatements();
        let i = 0;
        while (i < statements.length) {
            const assignment = getStyleAssignment(statements[i]);
            if (assignment) {
                const currentGroup: StyleGroup = {
                    elementText: assignment.elementText,
                    assignments: [
                        {
                            property: assignment.property,
                            valueText: assignment.valueText,
                            isComputed: assignment.isComputed,
                            statementNode: assignment.statementNode,
                        },
                    ],
                };

                // Look ahead to collect consecutive assignments to the same element
                let j = i + 1;
                while (j < statements.length) {
                    const nextAssignment = getStyleAssignment(statements[j]);
                    if (nextAssignment && nextAssignment.elementText === assignment.elementText) {
                        currentGroup.assignments.push({
                            property: nextAssignment.property,
                            valueText: nextAssignment.valueText,
                            isComputed: nextAssignment.isComputed,
                            statementNode: nextAssignment.statementNode,
                        });
                        j++;
                    } else {
                        break;
                    }
                }
                fileGroups.push(currentGroup);
                i = j;
            } else {
                i++;
            }
        }
    }

    if (fileGroups.length > 0) {
        console.log(`File: ${posixFilePath.slice(posixProjectRoot.length + 1)}`);

        // Process groups in reverse order to keep Node references valid when removing
        const reversedGroups = [...fileGroups].reverse();

        for (const group of reversedGroups) {
            const props = group.assignments.map((c) => {
                if (c.isComputed) {
                    if (
                        (c.property.startsWith("'") && c.property.endsWith("'")) ||
                        (c.property.startsWith('"') && c.property.endsWith('"')) ||
                        (c.property.startsWith("`") && c.property.endsWith("`"))
                    ) {
                        return `${c.property}: ${c.valueText}`;
                    }
                    return `[${c.property}]: ${c.valueText}`;
                }
                return `${c.property}: ${c.valueText}`;
            });

            let newText = "";
            if (props.length === 1) {
                newText = `${group.elementText}.setCssStyles({ ${props[0]} });`;
            } else {
                newText = `${group.elementText}.setCssStyles({\n    ${props.join(",\n    ")}\n});`;
            }

            const firstNode = group.assignments[0].statementNode;
            const { line } = sourceFile.getLineAndColumnAtPos(firstNode.getStart());

            console.log(`  Line ${line}: Replacing consecutive style assignments on "${group.elementText}" with:`);
            console.log(
                newText
                    .split("\n")
                    .map((l) => `    ${l}`)
                    .join("\n")
            );

            if (!isDryRun) {
                firstNode.replaceWithText(newText);
                for (let k = 1; k < group.assignments.length; k++) {
                    group.assignments[k].statementNode.remove();
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
