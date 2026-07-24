import { writeFileSync } from "fs";
import { allMessages } from "../src/common/messages/combinedMessages.dev.ts";
import path from "path";
const __dirname = import.meta.dirname;
const currentPath = __dirname;
const outDir = path.resolve(currentPath, "../src/common/messages/combinedMessages.prod.ts");

console.log(`Writing to ${outDir}`);
writeFileSync(
    outDir,
    `export const allMessages: Readonly<Record<string, Readonly<Record<string, string>>>> = ${JSON.stringify(allMessages, null, 4)};`
);
