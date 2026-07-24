// Avoid using Obsidian's native function for CLIs.
import { getLanguage } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import {
    commonlibEnglishMessages,
    englishMessageTranslator,
    type CommonlibMessageKey,
    type MessageTranslator,
} from "@vrtmrz/livesync-commonlib/context";
import { LOG_KIND_WARNING, notice } from "octagonal-wheels/common/logger";
import type { TaggedType } from "octagonal-wheels/common/types";
import type { AllMessageKeys, I18N_LANGS, LiveSyncCatalogueMessageKey } from "./rosetta";
import { allMessages } from "./messages/combinedMessages.prod.ts";
import {
    liveSyncProvisionalEnglishMessages,
    type LiveSyncProvisionalMessageKey,
} from "./messages/LiveSyncProvisionalMessages.ts";

const obsidianLangMap: Record<string, I18N_LANGS> = {
    de: "de",
    es: "es",
    ja: "ja",
    ko: "ko",
    ru: "ru",
    zh: "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh-tw": "zh-tw",
    "zh-hk": "zh-tw",
    "zh-mo": "zh-tw",
    "zh-hant": "zh-tw",
};

function resolveLanguage(lang: I18N_LANGS): I18N_LANGS {
    if (lang !== "") return lang;
    const obsidianLanguage = getLanguage().toLowerCase();
    return obsidianLangMap[obsidianLanguage] ?? "def";
}

export let currentLang: I18N_LANGS = resolveLanguage("");
const missingTranslations = [] as string[];
let __onMissingTranslations = (key: string) => notice(key, LOG_KIND_WARNING);
const msgCache = new Map<string, string>();

export function getResolvedLang(lang: I18N_LANGS = currentLang): I18N_LANGS {
    return resolveLanguage(lang);
}

export function isAutoDisplayLanguage(lang: I18N_LANGS): boolean {
    return lang === "";
}

export function __getMissingTranslations() {
    return missingTranslations;
}

export function __onMissingTranslation(callback: (key: string) => void) {
    __onMissingTranslations = callback;
}

export function setLang(lang: I18N_LANGS) {
    const resolvedLang = resolveLanguage(lang);
    if (resolvedLang === currentLang) return;
    currentLang = resolvedLang;
    msgCache.clear();
}

function _getMessage(key: string, lang: I18N_LANGS) {
    if (key.trim() == "") return key;

    const provisionalEnglish = liveSyncProvisionalEnglishMessages[key as LiveSyncProvisionalMessageKey];
    const msgs =
        allMessages[key] ?? (provisionalEnglish === undefined ? undefined : ({ def: provisionalEnglish } as const));
    if (msgs === undefined && isCommonlibMessageKey(key)) return englishMessageTranslator(key);
    const resolvedLang = resolveLanguage(lang);
    let msg = msgs?.[resolvedLang];

    if (!msg) {
        if (missingTranslations.indexOf(key) === -1) {
            __onMissingTranslations(key);
            missingTranslations.push(key);
        }
        msg = msgs?.def;
    }
    return msg ?? key;
}

function getMessage(key: string) {
    if (msgCache.has(key)) return msgCache.get(key) as string;
    const msg = _getMessage(key, currentLang);
    msgCache.set(key, msg);
    return msg;
}

export function $t(message: string, lang?: I18N_LANGS) {
    if (lang !== undefined) {
        return _getMessage(message, lang);
    }
    return getMessage(message);
}

export function translateIfAvailable(message: string, lang?: I18N_LANGS) {
    if (message.trim() == "" || (!isLiveSyncMessageKey(message) && !isCommonlibMessageKey(message))) return message;
    return $t(message, lang);
}

function isCommonlibMessageKey(key: string): key is CommonlibMessageKey {
    return key in commonlibEnglishMessages;
}

function isLiveSyncMessageKey(key: string): key is LiveSyncCatalogueMessageKey {
    return key in allMessages || key in liveSyncProvisionalEnglishMessages;
}

/**
 * TagFunction to Automatically translate.
 * @param strings
 * @param values
 * @returns
 */
export function $f(strings: TemplateStringsArray, ...values: string[]) {
    let result = "";
    for (let i = 0; i < values.length; i++) {
        result += getMessage(strings[i]) + values[i];
    }
    result += getMessage(strings[strings.length - 1]);
    return result;
}

export function $msg<T extends AllMessageKeys>(
    key: T,
    params: Record<string, string> = {},
    lang?: I18N_LANGS
): TaggedType<string, T> {
    let msg = $t(key, lang);
    for (const [placeholder, value] of Object.entries(params)) {
        const regex = new RegExp(`\\\${${placeholder}}`, "g");
        msg = msg.replace(regex, value);
    }
    return msg as TaggedType<string, T>;
}

/** Supplies the LiveSync-owned language catalogue through the Commonlib host boundary. */
export type LiveSyncMessageTranslator = MessageTranslator<AllMessageKeys>;

export const translateLiveSyncMessage: LiveSyncMessageTranslator = (key, params) => {
    if (!isLiveSyncMessageKey(key)) return englishMessageTranslator(key, params);
    return $msg(key, params === undefined ? undefined : { ...params });
};
