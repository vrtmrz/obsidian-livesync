import { glob } from "tinyglobby";
import { parse } from "yaml";
import { objectToDotted } from "./messagelib.ts";

const fsPromises = process.getBuiltinModule("node:fs/promises");
const path = process.getBuiltinModule("node:path");
const __dirname = import.meta.dirname;
const targetDir = path.resolve(path.join(__dirname, "../src/common/messagesYAML/"));
const files = (await glob(`*.yaml`, { expandDirectories: false, absolute: true, cwd: targetDir })).sort();

function flattenMessages(src: unknown) {
    return Object.fromEntries(
        Object.entries(objectToDotted(src))
            .map(([key, value]) => [key.endsWith("._value") ? key.slice(0, -7) : key, value] as const)
            .filter(([, value]) => typeof value === "string")
            .sort(([a], [b]) => a.localeCompare(b))
    ) as Record<string, string>;
}

const localeData = new Map<string, Record<string, string>>();
for (const file of files) {
    const segments = file.split(/[/\\]/);
    const localeFilename = segments[segments.length - 1];
    if (localeFilename === undefined) {
        throw new Error(`Could not determine the locale name for ${file}`);
    }
    const locale = localeFilename.replace(/\.yaml$/, "");
    const content = await fsPromises.readFile(file, "utf-8");
    const parsed: unknown = parse(content);
    localeData.set(locale, flattenMessages(parsed ?? {}));
}

const baseLocale = "en";
const base = localeData.get(baseLocale);
if (!base) {
    throw new Error("en.yaml not found");
}

const baseKeys = Object.keys(base);
const report = Object.fromEntries(
    [...localeData.entries()].map(([locale, data]) => {
        const keys = new Set(Object.keys(data));
        const missing = baseKeys.filter((key) => !keys.has(key));
        const identicalToEnglish = baseKeys.filter(
            (key) => keys.has(key) && locale !== baseLocale && data[key] === base[key]
        );
        const translated = baseKeys.length - missing.length;
        return [
            locale,
            {
                totalBaseKeys: baseKeys.length,
                translatedKeys: translated,
                missingKeys: missing.length,
                identicalToEnglishCount: identicalToEnglish.length,
                coverage: `${translated}/${baseKeys.length}`,
                missing,
                identicalToEnglish,
            },
        ];
    })
);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
