import { Project, SyntaxKind } from "npm:ts-morph";

function processFile(filePath: string) {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(filePath);

    // 1. Collect all 'any' type nodes in the file
    const anyTypeNodes = sourceFile.getDescendantsOfKind(SyntaxKind.AnyKeyword);
    const sourceText = sourceFile.getFullText();
    const lineBreak = sourceText.includes("\r\n") ? "\r\n" : "\n";
    const lines = sourceText.split(/\r?\n/);
    const targetLines = new Set<number>();

    // 2. Collect the line numbers that contain 'any'
    anyTypeNodes.forEach((anyNode: any) => {
        const { line } = sourceFile.getLineAndColumnAtPos(anyNode.getStart());
        targetLines.add(line - 1);
    });

    // 3. Add an inline disable only to lines that contain 'any'
    for (const lineIndex of targetLines) {
        const line = lines[lineIndex];
        if (!line) {
            continue;
        }
        if (line.includes("eslint-disable-line @typescript-eslint/no-explicit-any")) {
            continue;
        }
        lines[lineIndex] = `${line} // eslint-disable-line @typescript-eslint/no-explicit-any`;
    }

    const updatedSourceText = lines.join(lineBreak);

    // Output the result
    return updatedSourceText;
}

const targetDir = `./_types/`;

async function processDir(dirPath: string) {
    for await (const entry of Deno.readDir(dirPath)) {
        if (entry.isDirectory) {
            await processDir(`${dirPath}/${entry.name}`);
        }
        if (entry.isFile && entry.name.endsWith(".d.ts")) {
            const filePath = `${dirPath}/${entry.name}`;
            console.log(`Processing: ${filePath}`);
            const updatedContent = processFile(filePath);
            // Write the file. To revert, regenerate it with npm run lib:build:types.
            await Deno.writeTextFile(filePath, updatedContent);

            // console.log(`Updated content for ${filePath}:\n${updatedContent}\n`);
            console.log(`Processed: ${filePath}`);
        }
    }
}

await processDir(targetDir);
