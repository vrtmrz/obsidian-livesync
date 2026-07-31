import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import {
    REMOTE_POSTGREST,
    REMOTE_WEBDAV,
    serialisePostgRESTConnectionURI,
    serialiseWebDAVConnectionURI,
} from "@vrtmrz/livesync-commonlib/journal-storage";
import { generateReport } from "./reportTool";

vi.mock("./utils", () => ({
    requestToCouchDBWithCredentials: vi.fn(),
}));

describe("generateReport Journal connection redaction", () => {
    it.each([
        {
            remoteType: REMOTE_WEBDAV,
            settingKey: "webDAVactiveConnectionURI",
            secret: "webdav-secret",
            uri: serialiseWebDAVConnectionURI({
                endpoint: "https://dav.example/vault",
                username: "alice",
                password: "webdav-secret",
                prefix: "journal/",
                useCustomRequestHandler: false,
                customHeaders: "x-private-header: private-value",
            }),
        },
        {
            remoteType: REMOTE_POSTGREST,
            settingKey: "postgrestActiveConnectionURI",
            secret: "signed-jwt-secret",
            uri: serialisePostgRESTConnectionURI({
                endpoint: "https://journal.example",
                bearerToken: "signed-jwt-secret",
                vaultId: "private-vault-id",
                schema: "livesync_api",
                useCustomRequestHandler: false,
                customHeaders: "x-private-header: private-value",
            }),
        },
    ] as const)("redacts the flat $remoteType connection URI", async (provider) => {
        const settings = {
            ...DEFAULT_SETTINGS,
            remoteType: provider.remoteType,
            [provider.settingKey]: provider.uri,
        };
        const core = {
            services: {
                vault: {
                    isStorageInsensitive: () => false,
                },
            },
        } as any;

        const report = await generateReport(settings, core);
        const serialised = JSON.stringify(report);

        expect(serialised).not.toContain(provider.secret);
        expect(serialised).not.toContain("private-value");
        expect(report.pluginConfig[provider.settingKey]).toBe("𝑅𝐸𝐷𝐴𝐶𝑇𝐸𝐷");
    });
});
