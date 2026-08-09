// Convert Application convenient Message Resources (JSON) to Human-Editable format (YAML)
import { stringify } from "yaml";
import { glob } from "tinyglobby";
import { dottedToObject } from "./messagelib";

const fsPromises = process.getBuiltinModule("node:fs/promises");
const path = process.getBuiltinModule("node:path");
const __dirname = import.meta.dirname;

const targetDir = path.resolve(path.join(__dirname, "../src/common/messagesJson/"));
process.stdout.write(`Target directory: ${targetDir}\n`);
const files = await glob(`*.json`, { expandDirectories: false, absolute: true, cwd: targetDir });
for (const file of files) {
    const filePath = path.resolve(file);
    process.stdout.write(`Processing file: ${filePath}\n`);
    const content = await fsPromises.readFile(filePath, "utf-8");
    const jsonDataSrc: unknown = JSON.parse(content);
    if (typeof jsonDataSrc !== "object" || jsonDataSrc === null || Array.isArray(jsonDataSrc)) {
        throw new TypeError(`Expected ${filePath} to contain a JSON object`);
    }
    const jsonDataD2 = Object.fromEntries(
        Object.entries(jsonDataSrc).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    );
    const jsonData = dottedToObject(jsonDataD2);
    const yamlData = stringify(jsonData, { indent: 2 });
    const yamlFilePath = filePath.replace(/\.json$/, ".yaml").replace("Json", "YAML");
    await fsPromises.writeFile(yamlFilePath, yamlData, "utf-8");
    process.stdout.write(`Converted ${filePath} to ${yamlFilePath}\n`);
}

// console.dir(files, { depth: 0 });
