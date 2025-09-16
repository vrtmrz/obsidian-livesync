import { fireAndForget } from "../../../lib/src/common/utils.ts";
import { serialized } from "octagonal-wheels/concurrency/lock";
import type ObsidianLiveSyncPlugin from "../../../main.ts";

let plugin: ObsidianLiveSyncPlugin;
export function enableTestFunction(plugin_: ObsidianLiveSyncPlugin) {
    plugin = plugin_;
}
export function addDebugFileLog(message: any, stackLog = false) {
    fireAndForget(
        serialized("debug-log", async () => {
            const now = new Date();
            const filename = `debug-log`;
            const time = now.toISOString().split("T")[0];
            const outFile = `${filename}${time}.jsonl`;
            // const messageContent = typeof message == "string" ? message : message instanceof Error ? `${message.name}:${message.message}` : JSON.stringify(message, null, 2);
            const timestamp = now.toLocaleString();
            const timestampEpoch = now;
            let out = { timestamp: timestamp, epoch: timestampEpoch } as Record<string, any>;
            if (message instanceof Error) {
                // debugger;
                // console.dir(message.stack);
                out = { ...out, message };
            } else if (stackLog) {
                if (stackLog) {
                    const stackE = new Error();
                    const stack = stackE.stack;
                    out = { ...out, stack };
                }
            }
            if (typeof message == "object") {
                out = { ...out, ...message };
            } else {
                out = {
                    result: message,
                };
            }
            // const out = "--" + timestamp + "--\n" + messageContent + " " + (stack || "");
            // const out
            try {
                await plugin.storageAccess.appendHiddenFile(
                    plugin.app.vault.configDir + "/ls-debug/" + outFile,
                    JSON.stringify(out) + "\n"
                );
            } catch {
                //NO OP
            }
        })
    );
}
