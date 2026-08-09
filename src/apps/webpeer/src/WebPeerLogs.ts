import { LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { defaultLoggerEnv, setGlobalLogFunction } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { writable } from "svelte/store";

export const logs = writable<string[]>([]);

let bufferedLogs: string[] = [];
const maxLines = 10_000;

setGlobalLogFunction((message) => {
    const messageText = typeof message === "string" ? message : JSON.stringify(message);
    bufferedLogs.push(`${new Date().toISOString()}\u2001${messageText}`);
    if (bufferedLogs.length > maxLines) {
        bufferedLogs = bufferedLogs.slice(bufferedLogs.length - maxLines);
    }
    logs.set(bufferedLogs);
});
defaultLoggerEnv.minLogLevel = LOG_LEVEL_VERBOSE;
