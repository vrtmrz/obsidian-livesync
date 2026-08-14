import { $msg } from "@/common/translation.js";

export function getCouchDBServerFixConfirmation(settingKey: string, expectedValue: string) {
    return {
        title: $msg("Change CouchDB server setting"),
        message: $msg("Change CouchDB server setting '${SETTING}' to '${VALUE}'?", {
            SETTING: settingKey,
            VALUE: expectedValue,
        }),
    };
}
