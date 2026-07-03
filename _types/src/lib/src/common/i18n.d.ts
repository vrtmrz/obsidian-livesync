// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { AllMessageKeys, I18N_LANGS } from "./rosetta";
import type { TaggedType } from "./types";
export declare let currentLang: I18N_LANGS;
export declare function getResolvedLang(lang?: I18N_LANGS): I18N_LANGS;
export declare function isAutoDisplayLanguage(lang: I18N_LANGS): boolean;
export declare function __getMissingTranslations(): string[];
export declare function __onMissingTranslation(callback: (key: string) => void): void;
export declare function setLang(lang: I18N_LANGS): void;
export declare function $t(message: string, lang?: I18N_LANGS): string;
export declare function translateIfAvailable(message: string, lang?: I18N_LANGS): string;
/**
 * TagFunction to Automatically translate.
 * @param strings
 * @param values
 * @returns
 */
export declare function $f(strings: TemplateStringsArray, ...values: string[]): string;
export declare function $msg<T extends AllMessageKeys>(key: T, params?: Record<string, string>, lang?: I18N_LANGS): TaggedType<string, T>;
