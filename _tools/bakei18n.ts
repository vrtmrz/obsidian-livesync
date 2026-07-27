import { allMessages } from "../src/common/messages/combinedMessages.dev.ts";

const { writeFileSync } = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");
const __dirname = import.meta.dirname;
const currentPath = __dirname;
const outDir = path.resolve(currentPath, "../src/common/messages/combinedMessages.prod.ts");

process.stdout.write(`Writing to ${outDir}\n`);
writeFileSync(
    outDir,
    `export const allMessages: Readonly<Record<string, Readonly<Record<string, string>>>> = ${JSON.stringify(allMessages, null, 4)};`
);
