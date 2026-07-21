import { writeFileSync } from "fs";

import { allMessages } from "../src/common/messages/combinedMessages.prod.ts";
const __dirname = import.meta.dirname;
import path from "path";
const thisFileDir = __dirname;
const outDir = path.resolve(thisFileDir, "../src/common/messagesJson");

const out = {} as Record<string, { [key: string]: string | undefined }>;

for (const [key, value] of Object.entries(allMessages)) {
    //@ts-ignore
    for (const [lang, langValue] of Object.entries(allMessages[key])) {
        if (!out[lang]) out[lang] = {};
        if (lang in value) {
            out[lang][key] = langValue as string;
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
    const filename = `${lang}.json`;
    void writeFileSync(path.join(outDir, filename), JSON.stringify(value, null, 4));
}
