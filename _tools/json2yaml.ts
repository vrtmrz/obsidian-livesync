// Convert Application convenient Message Resources (JSON) to Human-Editable format (YAML)
import { readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { stringify } from "yaml";
import { glob } from "tinyglobby";
import { dottedToObject } from "./messagelib";
const __dirname = import.meta.dirname;

const targetDir = resolve(join(__dirname, "../src/common/messagesJson/"));
console.log(`Target directory: ${targetDir}`);
const files = await glob(`*.json`, { expandDirectories: false, absolute: true, cwd: targetDir });
for (const file of files) {
    const filePath = resolve(file);
    console.log(`Processing file: ${filePath}`);
    const content = await readFile(filePath, "utf-8");
    const jsonDataSrc = JSON.parse(content);
    const jsonDataD2 = Object.fromEntries(
        Object.entries(jsonDataSrc).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    );
    const jsonData = dottedToObject(jsonDataD2);
    const yamlData = stringify(jsonData, { indent: 2 });
    const yamlFilePath = filePath.replace(/\.json$/, ".yaml").replace("Json", "YAML");
    await writeFile(yamlFilePath, yamlData, "utf-8");
    console.log(`Converted ${filePath} to ${yamlFilePath}`);
}

// console.dir(files, { depth: 0 });
