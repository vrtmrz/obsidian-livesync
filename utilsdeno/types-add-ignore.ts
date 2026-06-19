import { Project, SyntaxKind } from "npm:ts-morph";

function processFile(filePath: string, origin: string, repoHash: string): string {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(filePath);
    let updated = false;

    // 0. insert a commit hash comment at the top of the file
    sourceFile.insertText(0, `// @ts-nocheck\n// REPO: ${origin}  Commit hash: ${repoHash}\n`);
    updated = true;

    // 1. Replacements for Uint8Array<ArrayBuffer> and DataView<ArrayBuffer>
    let sourceText = sourceFile.getFullText();
    if (sourceText.includes("Uint8Array<ArrayBuffer>") || sourceText.includes("DataView<ArrayBuffer>")) {
        sourceText = sourceText.replace(/Uint8Array<ArrayBuffer>/g, "Uint8Array");
        sourceText = sourceText.replace(/DataView<ArrayBuffer>/g, "DataView");
        sourceFile.replaceWithText(sourceText);
        updated = true;
    }

    // 2. Remove EventEmitter import from "events" and declare class EventEmitter inline
    const imports = sourceFile.getImportDeclarations();
    imports.forEach((importDecl) => {
        if (importDecl.getModuleSpecifierValue() === "events") {
            const defaultImport = importDecl.getDefaultImport();
            if (defaultImport && defaultImport.getText() === "EventEmitter") {
                importDecl.remove();
                sourceFile.addClass({
                    name: "EventEmitter",
                    isExported: false,
                    methods: [
                        {
                            name: "on",
                            parameters: [
                                { name: "event", type: "string | symbol" },
                                { name: "listener", type: "(...args: any[]) => void" },
                            ],
                            returnType: "this",
                        },
                        {
                            name: "once",
                            parameters: [
                                { name: "event", type: "string | symbol" },
                                { name: "listener", type: "(...args: any[]) => void" },
                            ],
                            returnType: "this",
                        },
                        {
                            name: "off",
                            parameters: [
                                { name: "event", type: "string | symbol" },
                                { name: "listener", type: "(...args: any[]) => void" },
                            ],
                            returnType: "this",
                        },
                        {
                            name: "emit",
                            parameters: [
                                { name: "event", type: "string | symbol" },
                                { name: "args", isRestParameter: true, type: "any[]" },
                            ],
                            returnType: "boolean",
                        },
                        {
                            name: "addListener",
                            parameters: [
                                { name: "event", type: "string | symbol" },
                                { name: "listener", type: "(...args: any[]) => void" },
                            ],
                            returnType: "this",
                        },
                        {
                            name: "removeListener",
                            parameters: [
                                { name: "event", type: "string | symbol" },
                                { name: "listener", type: "(...args: any[]) => void" },
                            ],
                            returnType: "this",
                        },
                        {
                            name: "removeAllListeners",
                            parameters: [{ name: "event", isOptional: true, type: "string | symbol" }],
                            returnType: "this",
                        },
                    ],
                });
                updated = true;
            }
        }
    });

    // 3. Collect targets for inline disable comments
    const targetAnyLines = new Set<number>();
    const targetEmptyObjectLines = new Set<number>();
    const targetEmptyInterfaceLines = new Set<number>();
    const targetDuplicateEnumLines = new Set<number>();

    // 3.1. 'any' type nodes
    const anyTypeNodes = sourceFile.getDescendantsOfKind(SyntaxKind.AnyKeyword);
    anyTypeNodes.forEach((anyNode: any) => {
        const { line } = sourceFile.getLineAndColumnAtPos(anyNode.getStart());
        targetAnyLines.add(line - 1);
    });

    // 3.2. Empty object type literals {}
    const typeLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.TypeLiteral);
    typeLiterals.forEach((node) => {
        if (node.getMembers().length === 0) {
            const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
            targetEmptyObjectLines.add(line - 1);
        }
    });

    // 3.3. Empty interfaces
    const interfaces = sourceFile.getInterfaces();
    interfaces.forEach((node) => {
        if (node.getMembers().length === 0) {
            const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
            targetEmptyInterfaceLines.add(line - 1);
        }
    });

    // 3.4. Duplicate enum member values
    const enums = sourceFile.getEnums();
    enums.forEach((enumDecl) => {
        const values = new Set<string>();
        enumDecl.getMembers().forEach((member) => {
            const initValue = member.getInitializer()?.getText();
            if (initValue) {
                if (values.has(initValue)) {
                    const { line } = sourceFile.getLineAndColumnAtPos(member.getStart());
                    targetDuplicateEnumLines.add(line - 1);
                } else {
                    values.add(initValue);
                }
            }
        });
    });

    // 4. Inject ignore comments line by line
    const finalSourceText = sourceFile.getFullText();
    const lineBreak = finalSourceText.includes("\r\n") ? "\r\n" : "\n";
    const lines = finalSourceText.split(/\r?\n/);

    // 4.1. Add inline disable to lines that contain 'any'
    for (const lineIndex of targetAnyLines) {
        const line = lines[lineIndex];
        if (!line) continue;
        if (line.includes("eslint-disable-line @typescript-eslint/no-explicit-any")) continue;
        lines[lineIndex] = `${line} // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration`;
        updated = true;
    }

    // 4.2. Add inline disable to lines that contain empty object {}
    for (const lineIndex of targetEmptyObjectLines) {
        const line = lines[lineIndex];
        if (!line) continue;
        if (line.includes("eslint-disable-line") || line.includes("eslint-disable-next-line")) continue;
        lines[lineIndex] =
            `${line} // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types -- Empty object type`;
        updated = true;
    }

    // 4.3. Add inline disable to lines that contain empty interface
    for (const lineIndex of targetEmptyInterfaceLines) {
        const line = lines[lineIndex];
        if (!line) continue;
        if (line.includes("eslint-disable-line") || line.includes("eslint-disable-next-line")) continue;
        lines[lineIndex] =
            `${line} // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- Empty interface`;
        updated = true;
    }

    // 4.4. Add inline disable to lines with duplicate enums
    for (const lineIndex of targetDuplicateEnumLines) {
        const line = lines[lineIndex];
        if (!line) continue;
        if (line.includes("eslint-disable-line") || line.includes("eslint-disable-next-line")) continue;
        lines[lineIndex] =
            `${line} // eslint-disable-line @typescript-eslint/no-duplicate-enum-values -- Duplicate enum value`;
        updated = true;
    }

    const updatedSourceText = lines.join(lineBreak);
    if (updated) {
        console.log(`Processed file: ${filePath}`);
    }
    return updatedSourceText;
}

const targetDir = `./_types`;

async function processDir(dirPath: string) {
    for await (const entry of Deno.readDir(dirPath)) {
        if (entry.isDirectory) {
            await processDir(`${dirPath}/${entry.name}`);
        }
        if (entry.isFile && entry.name.endsWith(".d.ts")) {
            const filePath = `${dirPath}/${entry.name}`;
            console.log(`Processing: ${filePath}`);
            const updatedContent = processFile(filePath, repoRemoteOriginStr, gitCommitHashStr);
            // Write the file. To revert, regenerate it with npm run lib:build:types.
            await Deno.writeTextFile(filePath, updatedContent);
        }
    }
}

const subDir = "./src/lib/";
const repoRemoteOrigins = new Deno.Command("git", {
    args: ["remote", "get-url", "origin"],
    cwd: subDir,
    stdout: "piped",
}).outputSync().stdout;
const repoRemoteOriginStr = new TextDecoder().decode(repoRemoteOrigins).trim();
console.log(`STAMP: Git remote origin: ${repoRemoteOriginStr}`);
const gitCommitHashSub = new Deno.Command("git", {
    args: ["rev-parse", "--short", "HEAD"],
    cwd: subDir,
    stdout: "piped",
}).outputSync().stdout;
const gitCommitHashStr = new TextDecoder().decode(gitCommitHashSub).trim();
console.log(`STAMP: Git commit hash: ${gitCommitHashStr}`);
await processDir(targetDir);
