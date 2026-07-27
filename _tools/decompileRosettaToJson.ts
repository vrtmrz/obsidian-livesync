import { allMessages } from "../src/common/messages/combinedMessages.prod.ts";
const __dirname = import.meta.dirname;

const { writeFileSync } = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");
const thisFileDir = __dirname;
const outDir = path.resolve(thisFileDir, "../src/common/messagesJson");

const out = {} as Record<string, { [key: string]: string | undefined }>;

for (const [key, value] of Object.entries(allMessages)) {
    for (const [lang, langValue] of Object.entries(value)) {
        if (!out[lang]) out[lang] = {};
        out[lang][key] = langValue;
    }
}

for (const [lang, value] of Object.entries(out)) {
    const filename = `${lang}.json`;
    void writeFileSync(path.join(outDir, filename), JSON.stringify(value, null, 4));
}
