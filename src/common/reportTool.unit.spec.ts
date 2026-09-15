import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { generateReport } from "./reportTool";

vi.mock("./utils", () => ({ requestToCouchDBWithCredentials: vi.fn() }));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", () => ({
    compatGlobal: { origin: "test", navigator: { userAgent: "test" } },
}));

describe("TURN credentials in diagnostic reports", () => {
    it("redacts top-level and inactive encoded source copies", async () => {
        const token = "private+token/with=symbols";
        const source = { version: 1, id: "cloudflare", configuration: { turnKeyId: "private-key", apiToken: token } };
        const settings = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_P2P,
            P2P_iceServerSource: source,
            remoteConfigurations: {
                inactive: {
                    id: "inactive",
                    name: "Inactive TURN",
                    isEncrypted: false,
                    uri: `sls+p2p://room?source=${encodeURIComponent(JSON.stringify(source))}`,
                },
            },
        };
        const core = { services: { vault: { isStorageInsensitive: () => false } } } as unknown as LiveSyncBaseCore;
        const report = await generateReport(settings, core);
        const text = JSON.stringify(report);
        expect(text).not.toContain(token);
        expect(text).not.toContain(encodeURIComponent(token));
        expect(text).not.toContain("private-key");
        expect(report.pluginConfig.remoteConfigurations.inactive.uri).toBe("sls+p2p://");
        expect(settings.P2P_iceServerSource).toEqual(source);
    });
});
