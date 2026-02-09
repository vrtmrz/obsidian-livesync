// Functional Test on Main Cases
// This test suite only covers main functional cases of synchronisation. Event handling, error cases,
// and edge, resolving conflicts, etc. will be covered in separate test suites.
import { describe } from "vitest";
import {
    PREFERRED_JOURNAL_SYNC,
    PREFERRED_SETTING_SELF_HOSTED,
    RemoteTypes,
    type ObsidianLiveSyncSettings,
} from "@/lib/src/common/types";

import { defaultFileOption } from "./db_common";
import { syncBasicCase } from "./sync.senario.basic.ts";
import { settingBase } from "./variables.ts";
const sync_test_setting_base = settingBase;
export const env = (import.meta as any).env;
function* generateCase() {
    const passpharse = "thetest-Passphrase3+9-for-e2ee!";
    const REMOTE_RECOMMENDED = {
        [RemoteTypes.REMOTE_COUCHDB]: PREFERRED_SETTING_SELF_HOSTED,
        [RemoteTypes.REMOTE_MINIO]: PREFERRED_JOURNAL_SYNC,
        [RemoteTypes.REMOTE_P2P]: PREFERRED_SETTING_SELF_HOSTED,
    };
    const remoteTypes = [RemoteTypes.REMOTE_COUCHDB, RemoteTypes.REMOTE_MINIO];
    // const remoteTypes = [RemoteTypes.REMOTE_P2P];
    const e2eeOptions = [false, true];
    // const e2eeOptions = [true];
    for (const remoteType of remoteTypes) {
        for (const useE2EE of e2eeOptions) {
            yield {
                setting: {
                    ...sync_test_setting_base,
                    ...REMOTE_RECOMMENDED[remoteType],
                    remoteType,
                    encrypt: useE2EE,
                    passphrase: useE2EE ? passpharse : "",
                    usePathObfuscation: useE2EE,
                } as ObsidianLiveSyncSettings,
            };
        }
    }
}

describe("Replication Suite Tests (Normal)", async () => {
    const cases = Array.from(generateCase());
    const fileOptions = defaultFileOption;
    describe.each(cases)("Replication Tests - Remote: $setting.remoteType, E2EE: $setting.encrypt", ({ setting }) => {
        syncBasicCase(`Remote: ${setting.remoteType}, E2EE: ${setting.encrypt}`, { setting, fileOptions });
    });
});
