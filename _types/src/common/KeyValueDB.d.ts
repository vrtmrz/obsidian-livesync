// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 4a23eaf
import type { KeyValueDatabase } from "@lib/interfaces/KeyValueDatabase.ts";
export { OpenKeyValueDatabase } from "./KeyValueDBv2.ts";
export declare const _OpenKeyValueDatabase: (dbKey: string) => Promise<KeyValueDatabase>;
