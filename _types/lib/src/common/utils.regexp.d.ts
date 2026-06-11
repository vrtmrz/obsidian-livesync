import type { CustomRegExpSource, ParsedCustomRegExp, CustomRegExpSourceList } from "@lib/common/models/shared.type.util";
import type { ObsidianLiveSyncSettings, RemoteDBSettings } from "@lib/common/models/setting.type";
/***
 * Parse custom regular expression
 * @param regexp
 * @returns [negate: boolean, regexp: string]
 * @example `!!foo` => [true, "foo"]
 * @example `foo` => [false, "foo"]
 */
export declare function parseCustomRegExp(regexp: CustomRegExpSource): ParsedCustomRegExp;
export declare function matchRegExp(regexp: CustomRegExpSource, target: string): boolean;
export declare function isValidRegExp(regexp: CustomRegExpSource): boolean;
export declare function isInvertedRegExp(regexp: CustomRegExpSource): boolean;
export declare function constructCustomRegExpList<D extends string>(items: CustomRegExpSource[], delimiter: D): CustomRegExpSourceList<D>;
export declare function splitCustomRegExpList<D extends string>(list: CustomRegExpSourceList<D>, delimiter: D): CustomRegExpSource[];
export declare class CustomRegExp {
    regexp: RegExp;
    negate: boolean;
    pattern: string;
    constructor(regexp: CustomRegExpSource, flags?: string);
    test(str: string): boolean;
}
type RegExpSettingKey = "syncOnlyRegEx" | "syncIgnoreRegEx" | "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns" | "syncInternalFileOverwritePatterns";
export declare function getFileRegExp(settings: ObsidianLiveSyncSettings | RemoteDBSettings, key: RegExpSettingKey): CustomRegExp[];
export {};
