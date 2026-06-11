import type { TaggedType } from "octagonal-wheels/common/types";
export type { TaggedType };
export type CustomRegExpSource = TaggedType<string, "CustomRegExp">;
export type CustomRegExpSourceList<D extends string = ","> = TaggedType<string, `CustomRegExpList${D}`>;
export type ParsedCustomRegExp = [isInverted: boolean, pattern: string];
export type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};
