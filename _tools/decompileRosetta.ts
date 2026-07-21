import { writeFileSync } from "fs";

import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "../src/common/rosetta";
import { allMessages } from "../src/common/messages/combinedMessages.dev.ts";

import path from "path";
const thisFileDir = __dirname;
const outDir = path.join(thisFileDir, "i18n");

const out = {} as Record<string, { [key: string]: string | undefined }>;

for (const [key, value] of Object.entries(allMessages)) {
    for (const lang of [...SUPPORTED_I18N_LANGS, "def"]) {
        if (!out[lang]) out[lang] = {};
        if (lang in value) {
            out[lang][key] = value[lang as I18N_LANGS];
        } else {
            if (lang === "def") {
                out[lang][key] = key;
            } else {
                out[lang][key] = undefined;
            }
        }
    }
}

for (const [lang, value] of Object.entries(out)) {
    const filename = `${lang}.ts`;
    const escapeString = (prefix: string, key: string, str: string) => {
        if (str.indexOf("\n") !== -1) {
            const encoded = JSON.stringify(str);
            const lineWrapped = encoded.split("\\n").join("\\\n" + prefix);

            return `${prefix}${JSON.stringify(key)}: ${lineWrapped},`;
        }
        return `${prefix}${JSON.stringify(key)}: ${JSON.stringify(str)},`;
    };
    // const z ="a"  "b" "c";
    const _stringify = (value: Record<string, string | undefined>) => {
        let res = "{\n";
        for (const key of Object.keys(value)) {
            const v = value[key];
            if (v) {
                res += escapeString("", key, v) + "\n";
            } else {
                res += escapeString("// ", key, out["def"]?.[key] ?? "") + "\n";
            }
        }
        return res + "\n}";
    };
    void writeFileSync(
        path.join(outDir, filename),
        `export const PartialMessages ={\n    "${lang}":${_stringify(value)}\n} as const;`
    );
}
