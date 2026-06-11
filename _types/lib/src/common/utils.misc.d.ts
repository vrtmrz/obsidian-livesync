export declare function tryParseJSON<T extends object>(str: string, fallbackValue?: T): T | undefined;
export declare function parseHeaderValues(strHeader: string): Record<string, string>;
export declare function memorizeFuncWithLRUCache<T, U>(func: (key: T) => U): (key: T) => U | undefined;
/**
 *
 * @param exclusion return only not exclusion
 * @returns
 *
 * ["something",false,"aaaaa"].filter(onlyNot(false)) => yields ["something","aaaaaa"]. but, as string[].
 */
export declare function onlyNot<A, B>(exclusion: B): (item: A | B) => item is Exclude<A, B>;
export declare function isDirty(key: string, value: unknown): boolean;
export declare function setAllItems<T>(set: Set<T>, items: T[]): Set<T>;
