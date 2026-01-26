import { LOG_LEVEL_VERBOSE } from "@lib/common/types";

import { defaultLoggerEnv, setGlobalLogFunction } from "@lib/common/logger";
import { writable } from "svelte/store";

export const logs = writable([] as string[]);

let _logs = [] as string[];

const maxLines = 10000;
setGlobalLogFunction((msg, level) => {
    console.log(msg);
    const msgstr = typeof msg === "string" ? msg : JSON.stringify(msg);
    const strLog = `${new Date().toISOString()}\u2001${msgstr}`;
    _logs.push(strLog);
    if (_logs.length > maxLines) {
        _logs = _logs.slice(_logs.length - maxLines);
    }
    logs.set(_logs);
});
defaultLoggerEnv.minLogLevel = LOG_LEVEL_VERBOSE;

export const storeP2PStatusLine = writable("");
