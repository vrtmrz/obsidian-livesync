// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
export declare class StoredMapLike<U> {
    _store: SimpleStore<U>;
    _cache: Map<string, U>;
    _prefix: string;
    constructor(store: SimpleStore<Awaited<U>>, prefix?: string);
    addPrefix(key: string): string;
    get(key: string): Promise<U | undefined>;
    set(key: string, value: U): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
}
