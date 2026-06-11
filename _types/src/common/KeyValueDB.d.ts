import type { KeyValueDatabase } from "@lib/interfaces/KeyValueDatabase.ts";
export { OpenKeyValueDatabase } from "./KeyValueDBv2.ts";
export declare const _OpenKeyValueDatabase: (dbKey: string) => Promise<KeyValueDatabase>;
