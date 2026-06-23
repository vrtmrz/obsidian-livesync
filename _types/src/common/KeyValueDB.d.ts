// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: f20eb19
import type { KeyValueDatabase } from "@lib/interfaces/KeyValueDatabase.ts";
export { OpenKeyValueDatabase } from "./KeyValueDBv2.ts";
export declare const _OpenKeyValueDatabase: (dbKey: string) => Promise<KeyValueDatabase>;
