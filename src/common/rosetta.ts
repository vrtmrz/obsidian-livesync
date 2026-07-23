/**
# Rosetta stone
- To localise messages to your language, please write a translation to this file and submit a PR.
- Please order languages in alphabetic order, if you write multiple items.

## Notice to ensure that your favours are not wasted.

If you plan to utilise machine translation engines to contribute translated resources,
please ensure the engine's terms of service are compatible with our project's license.
Your diligence in this matter helps maintain compliance and avoid potential licensing issues.
Thank you for your consideration.

Usually, our projects (Self-hosted LiveSync and its families) are licensed under MIT License.
To see details, please refer to the LICENSES file on each repository.

## How to internationalise untranslated items?
1. Change the message literal to use `$msg`
   "Could not parse YAML" -> $msg('anyKey')
2. Create `ls-debug` folder under the `.obsidian` folder of your vault.
3. Run Self-hosted LiveSync in dev mode (npm run dev).
4. You will get the `missing-translation-YYYY-MM-DD.jsonl` under `ls-debug`. Please copy and paste inside `allMessages` and write the translations.
5. Send me the PR!
*/

const LANG_DE = "de";
const LANG_ES = "es";
const LANG_FR = "fr";
const LANG_HE = "he";
const LANG_JA = "ja";
const LANG_RU = "ru";
const LANG_ZH = "zh";
const LANG_KO = "ko";
const LANG_ZH_TW = "zh-tw";
const LANG_DEF = "def"; // Default language: English

// Also please order in alphabetic order except for the default language.

export const SUPPORTED_I18N_LANGS = [
    LANG_DEF,
    LANG_DE,
    LANG_ES,
    LANG_FR,
    LANG_HE,
    LANG_JA,
    LANG_KO,
    LANG_RU,
    LANG_ZH,
    LANG_ZH_TW,
];

// Also this.
export type I18N_LANGS =
    | typeof LANG_DEF // Default language: English
    | typeof LANG_DE
    | typeof LANG_ES
    | typeof LANG_FR
    | typeof LANG_HE
    | typeof LANG_JA
    | typeof LANG_KO
    | typeof LANG_RU
    | typeof LANG_ZH
    | typeof LANG_ZH_TW
    | "";

export type MESSAGE = { [key in I18N_LANGS]?: string };

import { Logger } from "octagonal-wheels/common/logger";
import type { CommonlibMessageKey } from "@vrtmrz/livesync-commonlib/context";
import type { MessageKeys } from "./messages/combinedMessages.dev.ts";
import type { LiveSyncProvisionalMessageKey } from "./messages/LiveSyncProvisionalMessages.ts";

export function expandKeywords<T extends Record<string, U>, U extends Record<string, string>>(
    message: T,
    lang: I18N_LANGS,
    recurseLimit = 10
): T {
    if (recurseLimit <= 0) {
        Logger(
            `ExpandKeywords hit the recursion limit, returning the current state. but this is not expected. May recursive referenced.`
        );
        return message;
    }
    // const DEFAULT_ENGLISH = "en-GB"; //This is to balance the books with existing messages.
    // const langCode = (lang == "def" || lang == "") ? DEFAULT_ENGLISH : lang;

    // Generate keywords from all messages
    // This can handles the case where the message itself contains a keyword:
    // - task:`Some procedure`
    // - check: `%{task} checking`
    // - checkfailed: `%{check} failed`
    // If in this case `checkfailed` may `Some procedure checking failed`.
    // And, it can compress the rosetta stone: the message table.
    const keywordMap = new Map<string, string>();
    for (const [key, value] of Object.entries(message)) {
        const messageValue = value[lang];
        if (typeof messageValue !== "string") continue;
        const normalizedKey = key.startsWith("K.") ? key.substring("K.".length) : key;
        keywordMap.set(`%{${normalizedKey}}`, messageValue);
    }

    const ret = {
        ...message,
    } as Record<string, Record<string, string>>;
    let isChanged = false;
    for (const key of Object.keys(message)) {
        if (!(lang in ret[key])) continue;
        if (!ret[key][lang].includes("%{")) continue;
        const replaced = ret[key][lang].replace(/%\{[^}]+\}/g, (token) => keywordMap.get(token) ?? token);
        if (replaced !== ret[key][lang]) {
            ret[key][lang] = replaced;
            isChanged = true;
        }
    }
    if (isChanged) return expandKeywords(ret, lang, recurseLimit--) as T;

    return ret as T;
}

/** Keys translated by LiveSync itself, including English-only provisional messages. */
export type LiveSyncCatalogueMessageKey = MessageKeys | LiveSyncProvisionalMessageKey;

/** Keys accepted by the composed LiveSync and Commonlib translation boundary. */
export type AllMessageKeys = LiveSyncCatalogueMessageKey | CommonlibMessageKey;
