// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: f20eb19
import { PartialMessages as def } from "./def.ts";
import { type MESSAGE } from "@lib/common/rosetta.ts";
type MessageKeys = keyof typeof def.def;
export declare const allMessages: {
    [key: string]: MESSAGE;
};
export { type MessageKeys };
