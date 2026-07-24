import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { glob } from "tinyglobby";
import { parse } from "yaml";
import { objectToDotted } from "./messagelib.ts";

const __dirname = import.meta.dirname;
const targetDir = resolve(join(__dirname, "../src/common/messagesYAML/"));
const files = (await glob(`*.yaml`, { expandDirectories: false, absolute: true, cwd: targetDir })).sort();

function flattenMessages(src: Record<string, unknown>) {
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
    const locale = segments[segments.length - 1]!.replace(/\.yaml$/, "");
    const content = await readFile(file, "utf-8");
    localeData.set(locale, flattenMessages(parse(content) ?? {}));
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

console.log(JSON.stringify(report, null, 2));
