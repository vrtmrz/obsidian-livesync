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
    it("redacts provider tokens in all profiles and runtime credentials", async () => {
        const token = "private+token/with=symbols";
        const provider = { P2P_managedType: "CF", P2P_managedId: "private-key", P2P_managedToken: token };
        const settings = {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_P2P,
            ...provider,
            P2P_iceServers: [{ urls: "turn:example.test", username: "issued-user", credential: "issued-password" }],
            P2P_iceServersExpiresAt: 123456789,
            remoteConfigurations: {
                inactive: {
                    id: "inactive",
                    name: "Inactive TURN",
                    isEncrypted: false,
                    uri: `sls+p2p://room?managedType=CF&managedId=private-key&token=${encodeURIComponent(token)}`,
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
        expect(settings.P2P_managedToken).toBe(token);
        expect(text).not.toMatch(/issued-user|issued-password|P2P_iceServers/);
    });
});
