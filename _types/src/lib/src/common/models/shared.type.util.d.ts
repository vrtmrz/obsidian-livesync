// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { TaggedType } from "octagonal-wheels/common/types";
export type { TaggedType };
export type CustomRegExpSource = TaggedType<string, "CustomRegExp">;
export type CustomRegExpSourceList<D extends string = ","> = TaggedType<string, `CustomRegExpList${D}`>;
export type ParsedCustomRegExp = [isInverted: boolean, pattern: string];
export type Prettify<T> = {
    [K in keyof T]: T[K];
} & {}; // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types -- Empty object type
