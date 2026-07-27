// Convert Human-Editable format (YAML) to Application convenient Message Resources (JSON)

import { parse } from "yaml";
import { glob } from "tinyglobby";
import { objectToDotted } from "./messagelib";

const fsPromises = process.getBuiltinModule("node:fs/promises");
const path = process.getBuiltinModule("node:path");
const __dirname = import.meta.dirname;

const targetDir = path.resolve(path.join(__dirname, "../src/common/messagesYAML/"));
process.stdout.write(`Target directory: ${targetDir}\n`);
const files = await glob(`*.yaml`, { expandDirectories: false, absolute: true, cwd: targetDir });
for (const file of files) {
    const filePath = path.resolve(file);
    const content = await fsPromises.readFile(filePath, "utf-8");
    const jsonDataSrc: unknown = parse(content);
    const jsonDataD2 = objectToDotted(jsonDataSrc);
    const jsonData = Object.fromEntries(
        Object.entries(jsonDataD2)
            .map(([key, value]): [string, unknown] => [key.endsWith("._value") ? key.slice(0, -7) : key, value])
            .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    );
    const yamlData = JSON.stringify(jsonData, null, 4) + "\n";
    const yamlFilePath = filePath.replace(/\.yaml$/, ".json").replace("YAML", "Json");
    await fsPromises.writeFile(yamlFilePath, yamlData, "utf-8");
    process.stdout.write(`Converted ${filePath} to ${yamlFilePath}\n`);
}

// console.dir(files, { depth: 0 });
