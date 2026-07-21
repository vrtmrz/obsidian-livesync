import { PartialMessages as def } from "./def.ts";
import { PartialMessages as es } from "./es.ts";
import { PartialMessages as fr } from "./fr.ts";
import { PartialMessages as he } from "./he.ts";
import { PartialMessages as ja } from "./ja.ts";
import { PartialMessages as ko } from "./ko.ts";
import { PartialMessages as ru } from "./ru.ts";
import { PartialMessages as zh } from "./zh.ts";
import { PartialMessages as zhTw } from "./zh-tw.ts";
import { expandKeywords, type MESSAGE } from "@/common/rosetta.ts";

type MessageKeys = keyof typeof def.def;

const messages = {
    ...def,
    ...es,
    ...fr,
    ...he,
    ...ja,
    ...ko,
    ...ru,
    ...zh,
    ...zhTw,
};
const w = Object.entries(messages)
    .map(([lang, messageDefs]) => Object.entries(messageDefs).map(([key, value]) => [key, [lang, value]] as const))
    .flat();

const _allMessages = w.reduce(
    (acc, [key, value]) => {
        if (!acc[key]) acc[key] = {};
        acc[key][value[0]] = value[1];
        return acc;
    },
    {} as Record<string, Record<string, string>>
) as Record<MessageKeys, { [key: string]: string }>;

const expandedMessage = {
    ...expandKeywords(_allMessages, "def"),
    ...expandKeywords(_allMessages, "es"),
    ...expandKeywords(_allMessages, "fr"),
    ...expandKeywords(_allMessages, "ja"),
    ...expandKeywords(_allMessages, "ko"),
    ...expandKeywords(_allMessages, "ru"),
    ...expandKeywords(_allMessages, "zh"),
    ...expandKeywords(_allMessages, "zh-tw"),
};

export const allMessages = expandedMessage as { [key: string]: MESSAGE };
export { type MessageKeys };
