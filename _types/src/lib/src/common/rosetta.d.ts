// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
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
declare const LANG_DE = "de";
declare const LANG_ES = "es";
declare const LANG_FR = "fr";
declare const LANG_HE = "he";
declare const LANG_JA = "ja";
declare const LANG_RU = "ru";
declare const LANG_ZH = "zh";
declare const LANG_KO = "ko";
declare const LANG_ZH_TW = "zh-tw";
declare const LANG_DEF = "def";
export declare const SUPPORTED_I18N_LANGS: string[];
export type I18N_LANGS = typeof LANG_DEF | typeof LANG_DE | typeof LANG_ES | typeof LANG_FR | typeof LANG_HE | typeof LANG_JA | typeof LANG_KO | typeof LANG_RU | typeof LANG_ZH | typeof LANG_ZH_TW | "";
export type MESSAGE = {
    [key in I18N_LANGS]?: string;
};
import { type MessageKeys } from "./messages/combinedMessages.dev";
export declare function expandKeywords<T extends Record<string, U>, U extends Record<string, string>>(message: T, lang: I18N_LANGS, recurseLimit?: number): T;
export type AllMessageKeys = MessageKeys;
export {};
